// Grading domain types (Prompt 6). SERVER-ONLY — this module is imported by
// the /api orchestrator and runs candidate code in an isolated sandbox. The
// AiGrade shape below is what we persist to submission.ai_grade and what the
// trainee/trainer UIs render. It is ADVISORY for trainer_review / cross_track
// gates (the trainer decision via review_submission is authoritative) and is
// only auto-applied for auto_pass gates.

/** One scored dimension of a rubric (per-criterion breakdown). */
export interface AiGradeDimension {
  name: string;
  score: number;
  max: number;
  comment: string;
}

/** Captured sandbox / judge output attached to a grade for auditing. */
export interface AiGradeOutput {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  metrics?: Record<string, unknown>;
  traces?: unknown;
  test_results?: unknown;
}

/** The grading method used (mirrors exercise type, plus cross_track). */
export type GradingMethod = "code" | "rag" | "agent" | "judge" | "cross_track";

/**
 * The AI grade persisted to submission.ai_grade.
 *
 *  - status "graded"               -> grading ran and produced a verdict.
 *  - status "needs_manual_review"  -> config insufficient / non-determinable;
 *                                     route to a human, never auto pass/fail.
 *  - status "error"                -> grading threw; route to a human.
 */
export interface AiGrade {
  status: "graded" | "error" | "needs_manual_review";
  method: GradingMethod;
  passed?: boolean;
  /** Overall score, 0-100. */
  score?: number;
  max_score?: number;
  dimensions?: AiGradeDimension[];
  output?: AiGradeOutput;
  /** sha256 of the rubric JSON used by the judge, for calibration/audit. */
  judge_rubric_version?: string;
  note?: string;
  error?: string;
  graded_at: string;
}

/** Exercise type as stored in public.exercise.type. */
export type ExerciseType = "code" | "rag" | "agent" | "judge";

/** Module gate type as stored in public.module.gate_type. */
export type GateType = "auto_pass" | "trainer_review" | "cross_track";

/** Rubric snapshot from the exercise row. */
export interface Rubric {
  criteria?: Array<{
    name?: string;
    weight?: number;
    description?: string;
  }>;
  [key: string]: unknown;
}

/**
 * Context for a single grading run. Produced by the start_grading_submission
 * RPC (Task 2) and consumed by gradeSubmission (Task 1). The candidate
 * `artifact` is UNTRUSTED text.
 */
export interface SubmissionContext {
  submission_id: string;
  tenant_id: string;
  program_id: string;
  module_id: string;
  module_order: number;
  gate_type: GateType;
  artifact: string;
  exercise: {
    id: string;
    type: ExerciseType;
    prompt: string;
    rubric: Rubric;
    sandbox_config: SandboxConfig;
  };
}

/**
 * Free-form per-exercise grading configuration (public.exercise.sandbox_config,
 * default '{}'). Keys are optional; methods degrade to needs_manual_review when
 * a required key is missing. Authored by staff during generation/refinement.
 */
export interface SandboxConfig {
  runtime?: "node" | "python";
  /** Extra files to drop into the sandbox before running (tests, fixtures). */
  files?: Array<{ path: string; content: string }>;
  /** Where the candidate artifact is written. Defaults per method. */
  artifact_path?: string;
  /** Shell command (and args) that runs the grading/tests. */
  test_command?: string[];
  /** Optional command the Run/playground button executes (a dry run). Falls
   *  back to eval_command/test_command when absent. */
  run_command?: string[];
  /** RAG: command that runs the candidate pipeline + emits metrics JSON. */
  eval_command?: string[];
  /** Cross-track: the Quality eval suite entrypoint. */
  eval_files?: Array<{ path: string; content: string }>;
  /** Deployable-app milestone: reachability/behavior target. */
  target_url?: string;
  /** Cross-track: reference another submission's deployed artifact URL. */
  target_submission_id?: string;
  /** RAG baseline corpus / expected hits for precision/recall. */
  baseline?: unknown;
  [key: string]: unknown;
}
