// Learner runtime domain types + RPC wrappers (Prompt 5). Trainees read/write
// the generation tables (module/exercise/program) ONLY through the SECURITY
// DEFINER RPCs defined in 0005_learner_runtime.sql — never via direct selects
// (RLS on those tables is staff-only). Every wrapper throws on RPC error.

import { supabase } from "./supabase";
import type {
  EnrollmentStatus,
  GateStatus,
} from "./reporting";
import type { ExerciseType, GateType, Rubric } from "./generation";

// ---------------------------------------------------------------------------
// AUTO-GRADE boundary (client side)
// ---------------------------------------------------------------------------
// TRUE as of Prompt 6: submissions are routed through /api/submit-and-grade,
// which queues the submission (service-role start_grading_submission), runs the
// appropriate grader (code/rag/agent in an isolated sandbox, judge via Claude),
// then applies the gate (service-role apply_grading_result). AI grades are
// ADVISORY for trainer_review / cross_track (the trainer decision is final);
// only auto_pass advances on the AI grade alone.
export const AUTO_GRADE_ENABLED = true;

// ---------------------------------------------------------------------------
// Lesson block union (the 5 rich-content block types)
// ---------------------------------------------------------------------------
export type CalloutVariant = "info" | "warning" | "tip";

export type LessonBlock =
  | { type: "markdown"; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "video_embed"; url: string; caption: string }
  | { type: "image"; url: string; alt: string }
  | { type: "callout"; variant: CalloutVariant; text: string };

// ---------------------------------------------------------------------------
// Runtime payload shapes (returned by get_trainee_program)
// ---------------------------------------------------------------------------
export interface RuntimeExercise {
  id: string;
  type: ExerciseType;
  prompt: string;
  rubric: Rubric;
  /** Editor highlighting hint, derived server-side from sandbox_config.runtime. */
  language?: "javascript" | "python" | "text";
  /** True when the exercise has a runnable command (Run/playground button). */
  run_enabled?: boolean;
}

export interface TraineeModule {
  id: string;
  order: number;
  title: string;
  objectives: string[];
  lesson: LessonBlock[];
  gate_type: GateType;
  exercises: RuntimeExercise[];
}

// ---------------------------------------------------------------------------
// AI grade shape (mirrors api/grading/types.ts). ADVISORY for trainer_review /
// cross_track gates; only auto_pass advances on the AI grade alone.
// ---------------------------------------------------------------------------
export interface AiGradeDimension {
  name: string;
  score: number;
  max: number;
  comment: string;
}

export interface AiGradeOutput {
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  metrics?: Record<string, unknown>;
  traces?: unknown;
  test_results?: unknown;
}

export interface AiGrade {
  status: "graded" | "error" | "needs_manual_review" | "queued" | "grading";
  method?: "code" | "rag" | "agent" | "judge" | "cross_track";
  passed?: boolean;
  score?: number;
  max_score?: number;
  dimensions?: AiGradeDimension[];
  output?: AiGradeOutput;
  judge_rubric_version?: string;
  note?: string;
  error?: string;
  graded_at?: string;
}

export interface RuntimeSubmission {
  id: string;
  exercise_id: string | null;
  module_id: string | null;
  gate_status: GateStatus;
  trainer_grade: Record<string, unknown>;
  ai_grade: AiGrade & Record<string, unknown>;
  artifact: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
}

export interface TraineeProgram {
  enrolled: boolean;
  program?: {
    id: string;
    title: string;
    week_count: number;
    status: "draft" | "published";
  };
  enrollment?: {
    current_module_order: number;
    status: EnrollmentStatus;
    started_at: string | null;
    completed_at: string | null;
  };
  modules?: TraineeModule[];
  my_submissions?: RuntimeSubmission[];
}

export interface EnrolledProgramRow {
  program_id: string;
  title: string;
  week_count: number;
  status: EnrollmentStatus;
  current_module_order: number;
  total_modules: number;
}

export interface ReviewResult {
  submission_id: string;
  decision: "passed" | "failed";
  advanced: boolean;
  enrollment_status: EnrollmentStatus;
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------
export async function myEnrolledPrograms(): Promise<EnrolledProgramRow[]> {
  const { data, error } = await supabase.rpc("my_enrolled_programs");
  if (error) throw new Error(error.message);
  return (data as EnrolledProgramRow[]) ?? [];
}

export async function getTraineeProgram(
  programId: string,
): Promise<TraineeProgram> {
  const { data, error } = await supabase.rpc("get_trainee_program", {
    p_program_id: programId,
  });
  if (error) throw new Error(error.message);
  return (data as TraineeProgram) ?? { enrolled: false };
}

export interface GradeGateResult {
  gate_status: GateStatus;
  advanced: boolean;
  enrollment_status: EnrollmentStatus;
}

export interface SubmitAndGradeResult {
  submissionId: string;
  aiGrade: AiGrade;
  gate: GradeGateResult;
}

/**
 * Submit-and-grade (Prompt 6). Routes ALL exercise types through the server-only
 * /api/submit-and-grade endpoint with the caller's bearer token. The endpoint
 * queues the submission (insert-only), grades it, and applies the gate. AI
 * grades are advisory for trainer_review/cross_track; only auto_pass advances.
 */
export async function submitAndGrade(
  exerciseId: string,
  artifact: string,
): Promise<SubmitAndGradeResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch("/api/submit-and-grade", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ exerciseId, artifact }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & SubmitAndGradeResult;

  if (!res.ok) {
    throw new Error(json.error || `Grading failed (${res.status}).`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// Playground "Run" (Option B). A sandbox dry run of the current draft — NOT a
// submission (nothing is recorded, no gate moves). Returns captured output.
// ---------------------------------------------------------------------------
export interface RunExerciseResult {
  /** false when the exercise has no runnable command configured. */
  ran: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  note?: string;
}

export async function runExercise(
  exerciseId: string,
  artifact: string,
): Promise<RunExerciseResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch("/api/run-exercise", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ exerciseId, artifact }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & RunExerciseResult;

  if (!res.ok) {
    throw new Error(json.error || `Run failed (${res.status}).`);
  }
  return json;
}

export async function reviewSubmission(
  submissionId: string,
  decision: "passed" | "failed",
  trainerGrade: Record<string, unknown>,
): Promise<ReviewResult> {
  const { data, error } = await supabase.rpc("review_submission", {
    p_submission_id: submissionId,
    p_decision: decision,
    p_trainer_grade: trainerGrade,
  });
  if (error) throw new Error(error.message);
  return data as ReviewResult;
}
