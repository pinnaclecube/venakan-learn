import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, HttpError } from "./_auth.js";
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  parseJsonFromMessage,
  textFromContent,
} from "./_anthropic.js";
import { PROGRAM_SCHEMA } from "./_schemas.js";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a curriculum architect for Venakan, an AI engineering training company.
Given a canonical role definition, design a hands-on, week-by-week training program.

Return ONLY JSON matching this shape:
- week_count: an integer number of weeks, DEFENSIBLE from the role's skill count and depth.
  Justify it in week_count_rationale (e.g. an App Developer should be useful by ~week 4; deeper
  agent work sits in the back half of the program; more skill areas / higher autonomy targets warrant
  more weeks).
- week_count_rationale: a short paragraph explaining how you arrived at week_count.
- modules: an ordered array. Each module:
  - order: 1-based position in the sequence.
  - title: concise module title.
  - skill_area: the SPECIFIC skill_area from the role's skill_matrix this module advances.
  - objectives: array of learning objectives, each tied to that skill_area.
  - materials: a SHORT summary string of readings/resources (a one-or-two sentence fallback).
  - lesson: the RICH teaching content as an ORDERED array of 3–8 blocks the trainee reads in the
    runtime. Compose a real mini-lesson: open with a "markdown" intro block, add "markdown" blocks
    for key concepts, include a "code" block with a concrete example where the skill is technical,
    use a "callout" (variant info/warning/tip) for a key takeaway or pitfall, and optionally an
    "image" or "video_embed" (use only real https:// URLs; omit if unsure). Each block is one of:
      - { "type": "markdown", "text": "<GitHub-flavored markdown>" }
      - { "type": "code", "language": "<lang>", "code": "<source>" }
      - { "type": "video_embed", "url": "https://…", "caption": "…" }
      - { "type": "image", "url": "https://…", "alt": "…" }
      - { "type": "callout", "variant": "info"|"warning"|"tip", "text": "…" }
  - gate_type: one of "auto_pass", "trainer_review", "cross_track" — how the module is gated.
  - exercises: one or more exercises. Each exercise:
    - type: one of "code", "rag", "agent", "judge".
    - prompt: the task statement given to the trainee.
    - rubric: { criteria: [ { name, weight, description } ] } — weights should sum to roughly 1.

Sequence modules so foundational skills precede dependent ones. Ensure every skill_matrix skill_area
is covered by at least one module's objectives.`;

interface RubricOut {
  criteria: Array<{ name: string; weight: number; description: string }>;
}
interface ExerciseOut {
  type: string;
  prompt: string;
  rubric: RubricOut;
}
type LessonBlockOut =
  | { type: "markdown"; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "video_embed"; url: string; caption: string }
  | { type: "image"; url: string; alt: string }
  | { type: "callout"; variant: "info" | "warning" | "tip"; text: string };

interface ModuleOut {
  order: number;
  title: string;
  skill_area: string;
  objectives: string[];
  materials: string;
  lesson: LessonBlockOut[];
  gate_type: string;
  exercises: ExerciseOut[];
}
interface ProgramOut {
  week_count: number;
  week_count_rationale: string;
  modules: ModuleOut[];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await requireStaff(req);

    const { roleDefinitionId } = (req.body ?? {}) as {
      roleDefinitionId?: string;
    };
    if (!roleDefinitionId) {
      throw new HttpError(400, "roleDefinitionId is required.");
    }

    // Load the role definition and verify same tenant as caller.
    const { data: role, error: roleErr } = await admin
      .from("role_definition")
      .select("*")
      .eq("id", roleDefinitionId)
      .maybeSingle();
    if (roleErr) throw new HttpError(500, roleErr.message);
    if (!role) throw new HttpError(404, "Role definition not found.");
    if (role.tenant_id !== caller.tenant_id) {
      throw new HttpError(403, "Role definition belongs to another tenant.");
    }

    const anthropic = getAnthropicClient();

    const stream = anthropic.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: PROGRAM_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `Design a training program for this role definition:\n\n${JSON.stringify(
            {
              title: role.title,
              family: role.family,
              stack: role.stack,
              skill_matrix: role.skill_matrix,
              milestones: role.milestones,
            },
            null,
            2,
          )}`,
        },
      ],
    } as never);

    const msg = await stream.finalMessage();
    const raw = textFromContent(
      (msg as { content: Array<{ type: string; text?: string }> }).content,
    );

    let program: ProgramOut;
    try {
      program = parseJsonFromMessage<ProgramOut>(raw);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : "Bad model output.",
      });
    }

    const tenantId = caller.tenant_id;

    // Insert the program.
    const { data: programRow, error: progErr } = await admin
      .from("program")
      .insert({
        tenant_id: tenantId,
        role_definition_id: roleDefinitionId,
        week_count: program.week_count ?? 0,
        status: "draft",
        version: 1,
        created_by: caller.id,
      })
      .select("id")
      .single();
    if (progErr || !programRow) {
      throw new HttpError(500, progErr?.message ?? "Could not create program.");
    }
    const programId = programRow.id as string;

    // Insert modules and their exercises.
    const modules = Array.isArray(program.modules) ? program.modules : [];
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      const { data: moduleRow, error: modErr } = await admin
        .from("module")
        .insert({
          tenant_id: tenantId,
          program_id: programId,
          order: typeof m.order === "number" ? m.order : i + 1,
          title: m.title,
          objectives: m.objectives ?? [],
          materials: m.materials ?? null,
          lesson:
            Array.isArray(m.lesson) && m.lesson.length > 0
              ? m.lesson
              : [{ type: "markdown", text: m.materials || m.title }],
          gate_type: m.gate_type ?? "trainer_review",
        })
        .select("id")
        .single();
      if (modErr || !moduleRow) {
        throw new HttpError(500, modErr?.message ?? "Could not create module.");
      }
      const moduleId = moduleRow.id as string;

      const exercises = Array.isArray(m.exercises) ? m.exercises : [];
      if (exercises.length > 0) {
        const { error: exErr } = await admin.from("exercise").insert(
          exercises.map((ex) => ({
            tenant_id: tenantId,
            module_id: moduleId,
            type: ex.type,
            prompt: ex.prompt,
            rubric: ex.rubric ?? {},
            sandbox_config: {},
          })),
        );
        if (exErr) throw new HttpError(500, exErr.message);
      }
    }

    return res.status(200).json({ programId });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
