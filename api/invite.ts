import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, HttpError } from "./_auth";

const VALID_ROLES = ["admin", "trainer", "trainee"] as const;
type Role = (typeof VALID_ROLES)[number];

/**
 * Admin-only. Invites a user (invite-only, no public sign-up):
 *   1. creates the Supabase auth user in invited state + emails an invite link
 *   2. records an `invitation` row
 *   3. creates the `profile` row with status = 'invited'
 * All scoped to the admin's tenant. Uses the service-role key (server-only).
 */
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { admin, caller } = await requireAdmin(req);

    const { email, fullName, role } = (req.body ?? {}) as {
      email?: string;
      fullName?: string;
      role?: string;
    };

    const cleanEmail = (email ?? "").trim().toLowerCase();
    const cleanName = (fullName ?? "").trim();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw new HttpError(400, "A valid email is required.");
    }
    if (!VALID_ROLES.includes(role as Role)) {
      throw new HttpError(400, "Invalid role.");
    }

    const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const redirectTo = appUrl ? `${appUrl}/accept-invite` : undefined;

    // 1. Create the auth user + send the invite email.
    const { data: invited, error: inviteErr } =
      await admin.auth.admin.inviteUserByEmail(cleanEmail, {
        data: { full_name: cleanName },
        redirectTo,
      });

    if (inviteErr || !invited.user) {
      throw new HttpError(
        400,
        inviteErr?.message ?? "Could not create the invited user.",
      );
    }

    const userId = invited.user.id;
    const tenantId = caller.tenant_id;

    // 2. Record the invitation.
    const { error: invRowErr } = await admin.from("invitation").insert({
      tenant_id: tenantId,
      email: cleanEmail,
      role,
      token: userId,
      invited_by: caller.id,
      expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });
    if (invRowErr) throw new HttpError(500, invRowErr.message);

    // 3. Create the profile (idempotent on the auth user id).
    const { error: profErr } = await admin.from("profile").upsert(
      {
        id: userId,
        tenant_id: tenantId,
        full_name: cleanName || null,
        email: cleanEmail,
        role,
        status: "invited",
      },
      { onConflict: "id" },
    );
    if (profErr) throw new HttpError(500, profErr.message);

    return res.status(200).json({ ok: true, userId });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
