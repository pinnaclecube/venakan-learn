import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCaller, HttpError } from "./_auth.js";
import { previewRun } from "./grading/run.js";
import type { SandboxConfig } from "./grading/types.js";

// Sandbox runs take time (cold start + execution) — allow headroom.
export const maxDuration = 120;

/**
 * Playground "Run" (Option B). SERVER-ONLY.
 *
 * Executes the trainee's CURRENT draft in an isolated sandbox and returns the
 * captured output. It is NOT a submission: nothing is written and no gate moves.
 *
 * Flow:
 *   1. Verify the caller is an ACTIVE trainee.
 *   2. get_run_context (service role) validates enrolled + module-is-current +
 *      status-open and returns the server-only sandbox_config.
 *   3. previewRun() runs the draft in the sandbox (empty env, no secrets,
 *      always torn down) and returns stdout/stderr/exit.
 *
 * Best-effort, per-instance rate limiting guards against trivial spamming of an
 * expensive resource. Durable cross-instance limiting is a later enhancement.
 */

const COOLDOWN_MS = 3000;
const lastRunAt = new Map<string, number>();
const inFlight = new Set<string>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await getCaller(req);
    if (caller.role !== "trainee" || caller.status !== "active") {
      throw new HttpError(403, "Only active trainees can run exercises.");
    }

    const { exerciseId, artifact } = (req.body ?? {}) as {
      exerciseId?: string;
      artifact?: string;
    };
    if (!exerciseId) throw new HttpError(400, "exerciseId is required.");
    const cleanArtifact = typeof artifact === "string" ? artifact : "";

    // Best-effort rate limit (per instance).
    if (inFlight.has(caller.id)) {
      throw new HttpError(429, "A run is already in progress.");
    }
    const last = lastRunAt.get(caller.id) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      throw new HttpError(429, "Please wait a moment before running again.");
    }

    // Validate access + fetch the server-only sandbox_config.
    const { data: ctxData, error: ctxErr } = await admin.rpc("get_run_context", {
      p_profile_id: caller.id,
      p_exercise_id: exerciseId,
    });
    if (ctxErr) throw new HttpError(400, ctxErr.message);
    const cfg = ((ctxData as { sandbox_config?: SandboxConfig } | null)
      ?.sandbox_config ?? {}) as SandboxConfig;

    inFlight.add(caller.id);
    lastRunAt.set(caller.id, Date.now());
    try {
      const result = await previewRun(cfg, cleanArtifact);
      return res.status(200).json(result);
    } finally {
      inFlight.delete(caller.id);
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
