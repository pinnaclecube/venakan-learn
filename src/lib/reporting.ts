// Reporting domain types (Prompt 3). Mirrors the 0003 migration. Read-only:
// every shape below is fetched via RLS-protected selects or the one
// anonymized RPC (my_cohort_standing). No service-role access here.

export type EnrollmentStatus =
  | "not_started"
  | "in_progress"
  | "awaiting_review"
  | "completed";

export type GateStatus = "pending" | "passed" | "failed";

export const ENROLLMENT_STATUS_LABELS: Record<EnrollmentStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  awaiting_review: "Awaiting review",
  completed: "Completed",
};

export const GATE_STATUS_LABELS: Record<GateStatus, string> = {
  pending: "Pending",
  passed: "Passed",
  failed: "Failed",
};

// --- DB row shapes -----------------------------------------------------------
export interface Candidate {
  id: string;
  tenant_id: string;
  profile_id: string;
  track: string | null;
  created_at: string;
}

export interface Enrollment {
  id: string;
  tenant_id: string;
  candidate_id: string;
  program_id: string;
  current_module_order: number;
  status: EnrollmentStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface Submission {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  exercise_id: string | null;
  module_id: string | null;
  artifact: string | null;
  ai_grade: Record<string, unknown>;
  trainer_grade: Record<string, unknown>;
  gate_status: GateStatus;
  submitted_at: string | null;
  reviewed_at: string | null;
}

// --- Derived view-model shapes ----------------------------------------------
/** A flattened row for the trainer cohort table. */
export interface CohortRow {
  enrollmentId: string;
  name: string;
  track: string | null;
  programId: string;
  programTitle: string;
  currentOrder: number;
  currentModuleTitle: string | null;
  moduleCount: number;
  status: EnrollmentStatus;
  percentComplete: number;
  lastActivity: string | null;
  stuck: boolean;
}

export interface DistributionBucket {
  bucket: number;
  label: string;
  count: number;
}

/** The anonymized payload returned by public.my_cohort_standing(). */
export interface CohortStanding {
  enrolled: boolean;
  program_id?: string;
  cohort_size?: number;
  my_score?: number;
  my_rank?: number;
  /** "top X%" — lower is better. */
  percentile_top?: number;
  distribution?: DistributionBucket[];
  my_bucket?: number;
}
