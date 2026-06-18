import type { VercelRequest } from "@vercel/node";
import { getAdminClient } from "./_supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CallerProfile {
  id: string;
  tenant_id: string;
  email: string;
  role: "admin" | "trainer" | "trainee";
  status: "invited" | "active" | "disabled";
}

function bearer(req: VercelRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim() || null;
}

/**
 * Resolve the authenticated caller from their Supabase access token and load
 * their profile via the service-role client (bypassing RLS for the lookup).
 */
export async function getCaller(
  req: VercelRequest,
): Promise<{ admin: SupabaseClient; caller: CallerProfile }> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "Missing bearer token.");

  const admin = getAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) throw new HttpError(401, "Invalid session.");

  const { data: profile, error: profErr } = await admin
    .from("profile")
    .select("id, tenant_id, email, role, status")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profErr) throw new HttpError(500, profErr.message);
  if (!profile) throw new HttpError(403, "No profile for this user.");

  return { admin, caller: profile as CallerProfile };
}

/** Require an active admin caller. */
export async function requireAdmin(req: VercelRequest) {
  const ctx = await getCaller(req);
  if (ctx.caller.role !== "admin" || ctx.caller.status !== "active") {
    throw new HttpError(403, "Admin access required.");
  }
  return ctx;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
