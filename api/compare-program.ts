import type { VercelRequest, VercelResponse } from "@vercel/node";
import mammoth from "mammoth";
import { requireStaff, HttpError } from "./_auth.js";
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  parseJsonFromMessage,
  textFromContent,
} from "./_anthropic.js";
import { GATE_TYPE_VALUES, LESSON_BLOCK_SCHEMA, RUBRIC_SCHEMA } from "./_schemas.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are a curriculum architect for Venakan, an AI engineering training company.
You will be given (1) the APP-GENERATED training program as JSON (program metadata, ordered modules
with objectives/materials/lesson/gate_type, and each module's exercises with prompts and rubrics) and
(2) a trainer's OWN authored training program as free text. Compare them and propose concrete,
actionable changes to the app-generated program so it incorporates the best of the trainer's version
while staying internally consistent.

Return ONLY JSON of this shape:
- summary: a short paragraph comparing the two programs and explaining the thrust of your suggestions.
- suggestions: an array of concrete proposed changes. Each suggestion:
  - id: a short stable identifier (e.g. "s1", "s2").
  - op: one of "modify_module", "add_module", "remove_module", "modify_exercise".
  - target_module_order: the module's 1-based "order" the change targets (required for modify_module,
    remove_module, modify_exercise; omit for add_module).
  - target_exercise_index: the 0-based index of the exercise within the module (required for
    modify_exercise; omit otherwise).
  - title: a concise human-readable title for the change.
  - rationale: ONE short sentence on why, grounded in the trainer's version.
  - fields: the proposed new values. Only include keys relevant to the op:
    * modify_module / add_module: any of title, objectives (array of strings), materials (string),
      gate_type (one of "auto_pass","trainer_review","cross_track"), lesson (an ORDERED array of
      lesson blocks — same block shapes as the app program's lesson).
    * modify_exercise: prompt (string) and/or rubric ({ criteria: [ { name, weight, description } ] }).

Propose only changes that are genuinely supported by the trainer's authored program. Keep the number
of suggestions focused (typically 3-10). Each suggestion must be a single, concrete edit.`;

const COMPARE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "suggestions"],
  properties: {
    summary: { type: "string" },
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "op",
          "target_module_order",
          "target_exercise_index",
          "title",
          "rationale",
          "fields",
        ],
        properties: {
          id: { type: "string" },
          op: {
            type: "string",
            enum: [
              "modify_module",
              "add_module",
              "remove_module",
              "modify_exercise",
            ],
          },
          target_module_order: { type: "integer" },
          target_exercise_index: { type: "integer" },
          title: { type: "string" },
          rationale: { type: "string" },
          fields: {
            type: "object",
            additionalProperties: false,
            required: [
              "title",
              "objectives",
              "materials",
              "gate_type",
              "lesson",
              "prompt",
              "rubric",
            ],
            properties: {
              title: { type: "string" },
              objectives: { type: "array", items: { type: "string" } },
              materials: { type: "string" },
              gate_type: { type: "string", enum: [...GATE_TYPE_VALUES] },
              lesson: { type: "array", items: LESSON_BLOCK_SCHEMA },
              prompt: { type: "string" },
              rubric: RUBRIC_SCHEMA,
            },
          },
        },
      },
    },
  },
} as const;

type ComparePart =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
    };

/** Load the full app-generated program as a JSON-serializable object. */
async function loadAppProgram(
  admin: SupabaseClient,
  programId: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  const { data: program, error: progErr } = await admin
    .from("program")
    .select(
      "id, tenant_id, week_count, status, version, role_definition_id",
    )
    .eq("id", programId)
    .maybeSingle();
  if (progErr) throw new HttpError(500, progErr.message);
  if (!program || program.tenant_id !== tenantId) {
    throw new HttpError(404, "Program not found.");
  }

  const { data: role } = await admin
    .from("role_definition")
    .select("title, family")
    .eq("id", program.role_definition_id)
    .maybeSingle();

  const { data: modules, error: modErr } = await admin
    .from("module")
    .select("*")
    .eq("program_id", programId)
    .order("order", { ascending: true });
  if (modErr) throw new HttpError(500, modErr.message);

  const mods = modules ?? [];
  const moduleIds = mods.map((m) => m.id as string);
  let exercises: Record<string, unknown>[] = [];
  if (moduleIds.length > 0) {
    const { data: exData, error: exErr } = await admin
      .from("exercise")
      .select("*")
      .in("module_id", moduleIds);
    if (exErr) throw new HttpError(500, exErr.message);
    exercises = exData ?? [];
  }

  return {
    title: role?.title ?? "Program",
    role_family: role?.family ?? null,
    week_count: program.week_count,
    version: program.version,
    modules: mods.map((m) => ({
      order: m.order,
      title: m.title,
      objectives: m.objectives ?? [],
      materials: m.materials ?? "",
      lesson: m.lesson ?? [],
      gate_type: m.gate_type,
      exercises: exercises
        .filter((ex) => ex.module_id === m.id)
        .map((ex) => ({
          type: ex.type,
          prompt: ex.prompt,
          rubric: ex.rubric ?? { criteria: [] },
        })),
    })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await requireStaff(req);
    const tenantId = caller.tenant_id;

    const { programId, mode, storagePath, text } = (req.body ?? {}) as {
      programId?: string;
      mode?: "upload" | "text";
      storagePath?: string;
      text?: string;
    };

    if (!programId) throw new HttpError(400, "programId is required.");
    if (mode !== "upload" && mode !== "text") {
      throw new HttpError(400, "mode must be 'upload' or 'text'.");
    }

    const appProgram = await loadAppProgram(admin, programId, tenantId);

    // Build the user message content (authored text and/or a PDF document block).
    const userContent: ComparePart[] = [];

    if (mode === "text") {
      const clean = (text ?? "").trim();
      if (!clean) throw new HttpError(400, "text is required for text mode.");
      userContent.push({
        type: "text",
        text: `The trainer's authored training program (free text):\n\n${clean}`,
      });
    } else {
      const path = (storagePath ?? "").trim();
      if (!path) {
        throw new HttpError(400, "storagePath is required for upload mode.");
      }
      const { data: blob, error: dlErr } = await admin.storage
        .from("jd-uploads")
        .download(path);
      if (dlErr || !blob) {
        throw new HttpError(400, dlErr?.message ?? "Could not download upload.");
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const ext = path.split(".").pop()?.toLowerCase() ?? "";

      if (ext === "pdf") {
        userContent.push({
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: buffer.toString("base64"),
          },
        });
        userContent.push({
          type: "text",
          text: "The attached PDF is the trainer's authored training program.",
        });
      } else if (ext === "docx") {
        const { value } = await mammoth.extractRawText({ buffer });
        userContent.push({
          type: "text",
          text: `The trainer's authored training program:\n\n${value.trim()}`,
        });
      } else {
        userContent.push({
          type: "text",
          text: `The trainer's authored training program:\n\n${buffer
            .toString("utf-8")
            .trim()}`,
        });
      }
    }

    userContent.push({
      type: "text",
      text: `The APP-GENERATED program (JSON):\n\n${JSON.stringify(
        appProgram,
        null,
        2,
      )}\n\nCompare the two and return the comparison JSON.`,
    });

    const anthropic = getAnthropicClient();
    const stream = anthropic.messages.stream({
      model: ANTHROPIC_MODEL,
      max_tokens: 32000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: COMPARE_SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    } as never);

    const msg = await stream.finalMessage();
    const raw = textFromContent(
      (msg as { content: Array<{ type: string; text?: string }> }).content,
    );

    let result: { summary: string; suggestions: unknown[] };
    try {
      result = parseJsonFromMessage(raw);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : "Bad model output.",
      });
    }

    return res.status(200).json({
      summary: result.summary,
      suggestions: result.suggestions ?? [],
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
