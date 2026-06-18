// Shared domain types for Venakan Learn (foundation).

export type AppRole = "admin" | "trainer" | "trainee";

export type ProfileStatus = "invited" | "active" | "disabled";

export interface Profile {
  id: string;
  tenant_id: string;
  full_name: string | null;
  email: string;
  role: AppRole;
  status: ProfileStatus;
  created_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  plan: string | null;
  created_at: string;
}

export const ROLE_LABELS: Record<AppRole, string> = {
  admin: "Admin",
  trainer: "Trainer",
  trainee: "Trainee",
};

export const STATUS_LABELS: Record<ProfileStatus, string> = {
  invited: "Invited",
  active: "Active",
  disabled: "Disabled",
};

/** Roles that can be granted from the admin Invite dialog. */
export const ASSIGNABLE_ROLES: AppRole[] = ["admin", "trainer", "trainee"];
