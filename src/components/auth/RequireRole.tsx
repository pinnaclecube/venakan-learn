import { type ReactNode } from "react";
import { Redirect } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import type { AppRole } from "@/lib/types";
import { FullPageSpinner } from "@/components/layout/FullPageSpinner";

interface RequireRoleProps {
  /** Allowed roles. Omit to require any authenticated, active user. */
  roles?: AppRole[];
  children: ReactNode;
}

/**
 * Gate a route by authentication, active status, and (optionally) role.
 * - Not signed in            -> /login
 * - Signed in but not active  -> /login (e.g. invited/disabled)
 * - Wrong role                -> / (role-aware landing redirect)
 */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { loading, session, profile } = useAuth();

  if (loading) return <FullPageSpinner />;

  if (!session || !profile) return <Redirect to="/login" />;

  if (profile.status !== "active") return <Redirect to="/login" />;

  if (roles && !roles.includes(profile.role)) return <Redirect to="/" />;

  return <>{children}</>;
}
