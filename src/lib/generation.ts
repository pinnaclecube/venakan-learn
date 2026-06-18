import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Enums (mirror the 0002 migration)
// ---------------------------------------------------------------------------
export type SourceType = "jd_upload" | "prompt";
export type ProgramStatus = "draft" | "published";
export type GateType = "auto_pass" | "trainer_review" | "cross_track";
export type ExerciseType = "code" | "rag" | "agent" | "judge";
export type RefinementTargetKind = "program" | "module" | "exercise" | "rubric";

export type DeliveredTo =
  | "Independent"
  | "Supervised"
  | "Production-ready under supervision";

export const DELIVERED_TO_OPTIONS: DeliveredTo[] = [
  "Independent",
  "Supervised",
  "Production-ready under supervision",
];

export const GATE_TYPE_OPTIONS: GateType[] = [
  "auto_pass",
  "trainer_review",
  "cross_track",
];

export const GATE_TYPE_LABELS: Record<GateType, string> = {
  auto_pass: "Auto pass",
  trainer_review: "Trainer review",
  cross_track: "Cross-track",
};

export const EXERCISE_TYPE_LABELS: Record<ExerciseType, string> = {
  code: "Code",
  rag: "RAG",
  agent: "Agent",
  judge: "Judge",
};

// ---------------------------------------------------------------------------
// Canonical shapes
// ---------------------------------------------------------------------------
export interface SkillMatrixRow {
  skill_area: string;
  delivered_to: DeliveredTo;
}

export interface Milestone {
  name: string;
  indicator: string;
}

/** What parse-role returns / the review panel edits. */
export interface CanonicalRole {
  title: string;
  role_family: string;
  primary_stack: string[];
  responsibilities: string[];
  skill_matrix: SkillMatrixRow[];
  milestones: Milestone[];
}

export interface RubricCriterion {
  name: string;
  weight: number;
  description: string;
}

export interface Rubric {
  criteria: RubricCriterion[];
}

// ---------------------------------------------------------------------------
// DB row shapes
// ---------------------------------------------------------------------------
export interface RoleDefinition {
  id: string;
  tenant_id: string;
  title: string;
  family: string | null;
  stack: string[];
  skill_matrix: SkillMatrixRow[];
  milestones: Milestone[];
  source_type: SourceType;
  source_text: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Program {
  id: string;
  tenant_id: string;
  role_definition_id: string;
  week_count: number;
  status: ProgramStatus;
  version: number;
  created_by: string | null;
  created_at: string;
}

export interface Module {
  id: string;
  tenant_id: string;
  program_id: string;
  order: number;
  title: string;
  objectives: string[];
  materials: string | null;
  gate_type: GateType;
  created_at: string;
}

export interface Exercise {
  id: string;
  tenant_id: string;
  module_id: string;
  type: ExerciseType;
  prompt: string;
  rubric: Rubric;
  sandbox_config: Record<string, unknown>;
  created_at: string;
}

export interface Refinement {
  id: string;
  tenant_id: string;
  program_id: string;
  target_kind: RefinementTargetKind;
  target_id: string;
  prompt: string;
  diff: { old?: unknown; new?: unknown };
  author: string | null;
  created_at: string;
}

export interface DiffPayload {
  old?: unknown;
  new?: unknown;
}

// ---------------------------------------------------------------------------
// API client (bearer-token fetch to the /api serverless functions)
// ---------------------------------------------------------------------------
async function authedFetch<T>(path: string, body: unknown): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated.");

  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status}).`);
  }
  return json;
}

export interface ParseRoleInput {
  mode: SourceType;
  text?: string;
  storagePath?: string;
}

export function parseRole(input: ParseRoleInput) {
  return authedFetch<{ role: CanonicalRole; sourceText: string }>(
    "/api/parse-role",
    input,
  );
}

export function generateProgram(roleDefinitionId: string) {
  return authedFetch<{ programId: string }>("/api/generate-program", {
    roleDefinitionId,
  });
}

export interface RefineInput {
  programId: string;
  targetKind: RefinementTargetKind;
  targetId: string;
  prompt: string;
}

export function refine(input: RefineInput) {
  return authedFetch<{
    refinementId: string;
    diff: DiffPayload;
    newVersion: number;
  }>("/api/refine", input);
}

export function rollback(refinementId: string) {
  return authedFetch<{ ok: true; newVersion: number }>("/api/rollback", {
    refinementId,
  });
}
