import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireStaff, HttpError } from "./_auth.js";
import type { SupabaseClient } from "@supabase/supabase-js";

type TargetKind = "program" | "module" | "exercise" | "rubric";

/** Restore the artifact from a saved `diff.old`. Mirrors refine's applyArtifact. */
async function restoreArtifact(
  admin: SupabaseClient,
  kind: TargetKind,
  targetId: string,
  tenantId: string,
  old: Record<string, unknown>,
): Promise<void> {
  let error;
  if (kind === "program") {
    ({ error } = await admin
      .from("program")
      .update({ week_count: old.week_count })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else if (kind === "module") {
    ({ error } = await admin
      .from("module")
      .update({
        order: old.order,
        title: old.title,
        objectives: old.objectives ?? [],
        materials: old.materials ?? null,
        gate_type: old.gate_type,
      })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else if (kind === "exercise") {
    ({ error } = await admin
      .from("exercise")
      .update({
        type: old.type,
        prompt: old.prompt,
        rubric: old.rubric ?? {},
      })
      .eq("id", targetId)
      .eq("tenant_id", tenantId));
  } else {
    ({ error } = await admin
      .from("exercise")
      .update({ rubric: old })
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

    const { refinementId } = (req.body ?? {}) as { refinementId?: string };
    if (!refinementId) throw new HttpError(400, "refinementId is required.");

    const { data: ref, error: refErr } = await admin
      .from("refinement")
      .select("*")
      .eq("id", refinementId)
      .maybeSingle();
    if (refErr) throw new HttpError(500, refErr.message);
    if (!ref || ref.tenant_id !== tenantId) {
      throw new HttpError(404, "Refinement not found.");
    }

    const diff = (ref.diff ?? {}) as { old?: Record<string, unknown> };
    if (!diff.old) {
      throw new HttpError(400, "Refinement has no prior state to restore.");
    }

    await restoreArtifact(
      admin,
      ref.target_kind as TargetKind,
      ref.target_id as string,
      tenantId,
      diff.old,
    );

    // Bump the program version (rollback is itself a change).
    const { data: prog, error: progErr } = await admin
      .from("program")
      .select("version")
      .eq("id", ref.program_id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (progErr) throw new HttpError(500, progErr.message);
    const newVersion = ((prog?.version as number) ?? 1) + 1;
    const { error: bumpErr } = await admin
      .from("program")
      .update({ version: newVersion })
      .eq("id", ref.program_id)
      .eq("tenant_id", tenantId);
    if (bumpErr) throw new HttpError(500, bumpErr.message);

    return res.status(200).json({ ok: true, newVersion });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
