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
// Mirrors the server-side constant in submit_exercise(). While false, the
// client only shows a disabled "Run — available soon" hint for code/rag/agent
// exercises; the submission is still stored. Prompt 6 flips this to true.
export const AUTO_GRADE_ENABLED = false;

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

export interface RuntimeSubmission {
  id: string;
  exercise_id: string | null;
  module_id: string | null;
  gate_status: GateStatus;
  trainer_grade: Record<string, unknown>;
  ai_grade: Record<string, unknown>;
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

export interface SubmitResult {
  submission_id: string;
  gate_status: GateStatus;
  advanced: boolean;
  enrollment_status: EnrollmentStatus;
  note?: string | null;
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

export async function submitExercise(
  exerciseId: string,
  artifact: string,
): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc("submit_exercise", {
    p_exercise_id: exerciseId,
    p_artifact: artifact,
  });
  if (error) throw new Error(error.message);
  return data as SubmitResult;
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
