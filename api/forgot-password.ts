import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminClient } from "./_supabaseAdmin.js";
import { HttpError } from "./_auth.js";

/**
 * Public (no auth). Self-service password reset:
 *   1. validates the email shape,
 *   2. confirms a matching, non-disabled profile exists (per the product spec,
 *      we surface an explicit "User Not Found" rather than the usual
 *      anti-enumeration silent success),
 *   3. asks Supabase Auth to email a recovery link that lands on
 *      `${APP_URL}/reset-password`.
 * Uses the service-role client (server-only) only to look up the profile and
 * trigger the email.
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
    const { email } = (req.body ?? {}) as { email?: string };
    const cleanEmail = (email ?? "").trim().toLowerCase();

    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new HttpError(400, "A valid email is required.");
    }

    const admin = getAdminClient();

    // Confirm the user exists (and is not disabled) before sending anything.
    const { data: profile, error: lookupErr } = await admin
      .from("profile")
      .select("id, status")
      .eq("email", cleanEmail)
      .maybeSingle();
    if (lookupErr) throw new HttpError(500, lookupErr.message);
    if (!profile || profile.status === "disabled") {
      throw new HttpError(404, "User Not Found.");
    }

    const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
    const redirectTo = appUrl ? `${appUrl}/reset-password` : undefined;

    // Trigger the recovery email through Supabase Auth's configured SMTP.
    const { error: sendErr } = await admin.auth.resetPasswordForEmail(
      cleanEmail,
      redirectTo ? { redirectTo } : undefined,
    );
    if (sendErr) throw new HttpError(500, sendErr.message);

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
