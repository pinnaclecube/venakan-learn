// Publish & assignment domain (Prompt 4). All writes go through the single
// transactional RPC public.publish_and_assign (SECURITY DEFINER, atomic); reads
// are plain RLS-protected selects available to staff. No service-role access.

import { supabase } from "./supabase";
import type { AppRole } from "./types";

// --- Types -------------------------------------------------------------------
export interface ProgramTrainer {
  id: string;
  tenant_id: string;
  program_id: string;
  trainer_profile_id: string;
  assigned_by: string | null;
  created_at: string;
}

/** Matches the jsonb returned by public.publish_and_assign(). */
export interface AssignmentSummary {
  published: boolean;
  trainers_assigned: number;
  enrolled_new: number;
  skipped_existing: number;
  unenrolled: number;
}

export interface AssignableProfile {
  id: string;
  full_name: string | null;
  email: string;
  role: AppRole;
  track?: string | null;
}

export interface EnrolledTrainee {
  profileId: string;
  fullName: string | null;
  status: string;
}

export interface ProgramAssignment {
  trainers: AssignableProfile[];
  enrolledProfileIds: string[];
  enrolled: EnrolledTrainee[];
}

// --- Mutations ---------------------------------------------------------------
/**
 * Publish the program AND apply its roster in one atomic transaction. Re-running
 * with the same inputs is idempotent (existing trainers/enrollments are skipped
 * via ON CONFLICT DO NOTHING). Trainees are unenrolled — and their submissions
 * permanently deleted — ONLY for ids passed in unenrollProfileIds.
 */
export async function publishAndAssign(
  programId: string,
  trainerProfileIds: string[],
  traineeProfileIds: string[],
  unenrollProfileIds: string[],
): Promise<AssignmentSummary> {
  const { data, error } = await supabase.rpc("publish_and_assign", {
    p_program_id: programId,
    p_trainer_profile_ids: trainerProfileIds,
    p_trainee_profile_ids: traineeProfileIds,
    p_unenroll_profile_ids: unenrollProfileIds,
  });
  if (error) throw new Error(error.message);
  return data as unknown as AssignmentSummary;
}

// --- Reads -------------------------------------------------------------------
/** Active admins + trainers eligible to review this program. */
export async function loadAssignableStaff(): Promise<AssignableProfile[]> {
  const { data, error } = await supabase
    .from("profile")
    .select("id, full_name, email, role")
    .eq("status", "active")
    .in("role", ["admin", "trainer"])
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as unknown as AssignableProfile[]) ?? [];
}

/** Active trainees, annotated with their track if a candidate row exists. */
export async function loadAssignableTrainees(): Promise<AssignableProfile[]> {
  const { data, error } = await supabase
    .from("profile")
    .select("id, full_name, email, role, candidate(track)")
    .eq("status", "active")
    .eq("role", "trainee")
    .order("full_name", { ascending: true });
  if (error) throw new Error(error.message);
  const rows =
    (data as unknown as Array<
      AssignableProfile & { candidate: { track: string | null } | null }
    >) ?? [];
  return rows.map((r) => ({
    id: r.id,
    full_name: r.full_name,
    email: r.email,
    role: r.role,
    track: r.candidate?.track ?? null,
  }));
}

/** Current trainers + enrolled trainees for a program (staff-readable via RLS). */
export async function loadProgramAssignment(
  programId: string,
): Promise<ProgramAssignment> {
  const [ptRes, enrRes] = await Promise.all([
    supabase
      .from("program_trainer")
      .select("trainer_profile_id, profile:trainer_profile_id(id, full_name, email, role)")
      .eq("program_id", programId),
    supabase
      .from("enrollment")
      .select("status, candidate(profile_id, profile(id, full_name))")
      .eq("program_id", programId),
  ]);

  if (ptRes.error) throw new Error(ptRes.error.message);
  if (enrRes.error) throw new Error(enrRes.error.message);

  const trainers: AssignableProfile[] = (
    (ptRes.data as unknown as Array<{
      profile: {
        id: string;
        full_name: string | null;
        email: string;
        role: AppRole;
      } | null;
    }>) ?? []
  )
    .map((r) => r.profile)
    .filter((p): p is NonNullable<typeof p> => p != null)
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      email: p.email,
      role: p.role,
    }));

  const enrolled: EnrolledTrainee[] = (
    (enrRes.data as unknown as Array<{
      status: string;
      candidate: {
        profile_id: string;
        profile: { id: string; full_name: string | null } | null;
      } | null;
    }>) ?? []
  )
    .filter((r) => r.candidate != null)
    .map((r) => ({
      profileId: r.candidate!.profile_id,
      fullName: r.candidate!.profile?.full_name ?? null,
      status: r.status,
    }));

  return {
    trainers,
    enrolledProfileIds: enrolled.map((e) => e.profileId),
    enrolled,
  };
}
