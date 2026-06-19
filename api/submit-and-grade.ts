import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCaller, HttpError } from "./_auth.js";
import { gradeSubmission } from "./grading/methods.js";
import type { AiGrade, SubmissionContext } from "./grading/types.js";

// Grading runs candidate code in a sandbox + may call Claude — allow time.
export const maxDuration = 300;

/**
 * Submit-and-grade orchestrator (Prompt 6). SERVER-ONLY.
 *
 * Flow:
 *   1. Verify the caller is an ACTIVE trainee (else 403).
 *   2. start_grading_submission (service role) — queues an insert-only
 *      submission row (history preserved) and returns the grading context.
 *   3. gradeSubmission(context) — runs the appropriate grader. Candidate code
 *      executes ONLY inside the isolated sandbox with NO secrets / internal
 *      network access.
 *   4. apply_grading_result (service role) — writes ai_grade and applies the
 *      gate. AI grade is ADVISORY for trainer_review/cross_track; only auto_pass
 *      advances on the AI grade alone. Errors route to manual review.
 *
 * The submit/advance logic lives in the SECURITY DEFINER RPCs (service-role
 * only) so the trainee can never self-advance.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await getCaller(req);
    if (caller.role !== "trainee" || caller.status !== "active") {
      throw new HttpError(403, "Only active trainees can submit exercises.");
    }

    const { exerciseId, artifact } = (req.body ?? {}) as {
      exerciseId?: string;
      artifact?: string;
    };
    if (!exerciseId) throw new HttpError(400, "exerciseId is required.");
    const cleanArtifact = typeof artifact === "string" ? artifact : "";

    // 1. Queue the submission (insert-only) and get the grading context.
    const { data: ctxData, error: startErr } = await admin.rpc(
      "start_grading_submission",
      {
        p_profile_id: caller.id,
        p_exercise_id: exerciseId,
        p_artifact: cleanArtifact,
      },
    );
    if (startErr) throw new HttpError(400, startErr.message);

    const context = ctxData as unknown as SubmissionContext;
    if (!context?.submission_id) {
      throw new HttpError(500, "Failed to queue submission for grading.");
    }
    // start_grading_submission stores the artifact; carry it into the context.
    context.artifact = cleanArtifact;

    // 2. Grade. On ANY throw, route to manual review (never left silent).
    let aiGrade: AiGrade;
    try {
      aiGrade = await gradeSubmission(context);
    } catch (err) {
      aiGrade = {
        status: "error",
        method:
          context.gate_type === "cross_track"
            ? "cross_track"
            : context.exercise.type,
        note: "needs manual review",
        error: err instanceof Error ? err.message : "Grading failed.",
        graded_at: new Date().toISOString(),
      };
    }

    // 3. Apply the grade + gate (service role).
    const { data: gateData, error: applyErr } = await admin.rpc(
      "apply_grading_result",
      {
        p_submission_id: context.submission_id,
        p_ai_grade: aiGrade,
        p_passed: aiGrade.passed ?? false,
      },
    );
    if (applyErr) throw new HttpError(500, applyErr.message);

    return res.status(200).json({
      submissionId: context.submission_id,
      aiGrade,
      gate: gateData,
    });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
