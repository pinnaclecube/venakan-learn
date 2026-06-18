import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, HttpError } from "./_auth.js";
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  parseJsonFromMessage,
  textFromContent,
} from "./_anthropic.js";
import { MODULE_SCHEMA, EXERCISE_SCHEMA, RUBRIC_SCHEMA } from "./_schemas.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const maxDuration = 300;

type TargetKind = "program" | "module" | "exercise" | "rubric";

const SYSTEM_PROMPT = `You are a curriculum architect for Venakan, an AI engineering training company.
You will be given the CURRENT version of a single artifact (a program summary, a module, an exercise,
or an exercise rubric) and a natural-language refinement request. Produce a REVISED version of ONLY
that artifact, honoring the request while keeping it internally consistent and faithful to its shape.
Return ONLY JSON for the revised artifact.`;

// For "program" refinements we only let the model adjust program-level fields
// that we persist (week_count + rationale). Modules are refined separately.
const PROGRAM_REFINE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["week_count", "week_count_rationale"],
  properties: {
    week_count: { type: "integer" },
    week_count_rationale: { type: "string" },
  },
} as const;

function schemaFor(kind: TargetKind) {
  switch (kind) {
    case "program":
      return PROGRAM_REFINE_SCHEMA;
    case "module":
      return MODULE_SCHEMA;
    case "exercise":
      return EXERCISE_SCHEMA;
    case "rubric":
      return RUBRIC_SCHEMA;
  }
}

/** Load the current artifact JSON for the given target. */
async function loadArtifact(
  admin: SupabaseClient,
  kind: TargetKind,
  targetId: string,
  tenantId: string,
): Promise<Record<string, unknown>> {
  if (kind === "program") {
    const { data, error } = await admin
      .from("program")
      .select("id, tenant_id, week_count")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data || data.tenant_id !== tenantId)
      throw new HttpError(404, "Program not found.");
    return { week_count: data.week_count, week_count_rationale: "" };
  }
  if (kind === "module") {
    const { data, error } = await admin
      .from("module")
      .select("*")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new HttpError(500, error.message);
    if (!data || data.tenant_id !== tenantId)
      throw new HttpError(404, "Module not found.");
    return {
      order: data.order,
      title: data.title,
      skill_area: "",
      objectives: data.objectives ?? [],
      materials: data.materials ?? "",
      gate_type: data.gate_type,
      exercises: [],
    };
  }
  // exercise OR rubric — both keyed off the exercise row.
  const { data, error } = await admin
    .from("exercise")
    .select("*")
    .eq("id", targetId)
    .maybeSingle();
  if (error) throw new HttpError(500, error.message);
  if (!data || data.tenant_id !== tenantId)
    throw new HttpError(404, "Exercise not found.");
  if (kind === "rubric") {
    return (data.rubric ?? { criteria: [] }) as Record<string, unknown>;
  }
  return {
    type: data.type,
    prompt: data.prompt,
    rubric: data.rubric ?? { criteria: [] },
  };
}

/** Apply the revised artifact back to the row(s). */
async function applyArtifact(
  admin: SupabaseClient,
  kind: TargetKind,
  targetId: string,
  tenantId: string,
  revised: Record<string, unknown>,
): Promise<void> {
  let error;
  if (kind === "program") {
    ({ error } = await admin
      .from("program")
      .update({ week_count: revised.week_count })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else if (kind === "module") {
    ({ error } = await admin
      .from("module")
      .update({
        order: revised.order,
        title: revised.title,
        objectives: revised.objectives ?? [],
        materials: revised.materials ?? null,
        gate_type: revised.gate_type,
      })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else if (kind === "exercise") {
    ({ error } = await admin
      .from("exercise")
      .update({
        type: revised.type,
        prompt: revised.prompt,
        rubric: revised.rubric ?? {},
      })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else {
    // rubric
    ({ error } = await admin
      .from("exercise")
      .update({ rubric: revised })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  }
  if (error) throw new HttpError(500, error.message);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await requireStaff(req);
    const tenantId = caller.tenant_id;

    const { programId, targetKind, targetId, prompt } = (req.body ?? {}) as {
      programId?: string;
      targetKind?: TargetKind;
      targetId?: string;
      prompt?: string;
    };

    if (!programId || !targetId || !prompt) {
      throw new HttpError(400, "programId, targetId and prompt are required.");
    }
    if (
      targetKind !== "program" &&
      targetKind !== "module" &&
      targetKind !== "exercise" &&
      targetKind !== "rubric"
    ) {
      throw new HttpError(400, "Invalid targetKind.");
    }

    // Verify the program belongs to the caller's tenant.
    const { data: prog, error: progErr } = await admin
      .from("program")
      .select("id, tenant_id, version")
      .eq("id", programId)
      .maybeSingle();
    if (progErr) throw new HttpError(500, progErr.message);
    if (!prog || prog.tenant_id !== tenantId) {
      throw new HttpError(404, "Program not found.");
    }

    const current = await loadArtifact(admin, targetKind, targetId, tenantId);

    const anthropic = getAnthropicClient();
    const message = await anthropic.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: "json_schema", schema: schemaFor(targetKind) },
      },
      messages: [
        {
          role: "user",
          content: `Artifact kind: ${targetKind}\n\nCURRENT artifact:\n${JSON.stringify(
            current,
            null,
            2,
          )}\n\nRefinement request:\n${prompt}\n\nReturn the revised artifact as JSON.`,
        },
      ],
    } as never);

    const raw = textFromContent(
      (message as { content: Array<{ type: string; text?: string }> }).content,
    );

    let revised: Record<string, unknown>;
    try {
      revised = parseJsonFromMessage<Record<string, unknown>>(raw);
    } catch (err) {
      return res.status(502).json({
        error: err instanceof Error ? err.message : "Bad model output.",
      });
    }

    const diff = { old: current, new: revised };

    // Record the refinement.
    const { data: refRow, error: refErr } = await admin
      .from("refinement")
      .insert({
        tenant_id: tenantId,
        program_id: programId,
        target_kind: targetKind,
        target_id: targetId,
        prompt,
        diff,
        author: caller.id,
      })
      .select("id")
      .single();
    if (refErr || !refRow) {
      throw new HttpError(500, refErr?.message ?? "Could not save refinement.");
    }

    // Apply the revised artifact and bump the program version.
    await applyArtifact(admin, targetKind, targetId, tenantId, revised);

    const newVersion = (prog.version ?? 1) + 1;
    const { error: bumpErr } = await admin
      .from("program")
      .update({ version: newVersion })
      .eq("id", programId)
      .eq("tenant_id", tenantId);
    if (bumpErr) throw new HttpError(500, bumpErr.message);

    return res
      .status(200)
      .json({ refinementId: refRow.id, diff, newVersion });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
