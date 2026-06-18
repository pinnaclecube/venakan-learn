import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireAdmin, HttpError } from "./_auth.js";

/**
 * Admin-only. Disables a user within the admin's tenant: flips
 * profile.status to 'disabled' and bans the auth user so they cannot sign in.
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
    const { userId } = (req.body ?? {}) as { userId?: string };

    if (!userId) throw new HttpError(400, "userId is required.");
    if (userId === caller.id) {
      throw new HttpError(400, "You cannot disable your own account.");
    }

    // Confirm the target is in the same tenant before touching anything.
    const { data: target, error: tErr } = await admin
      .from("profile")
      .select("id, tenant_id")
      .eq("id", userId)
      .maybeSingle();
    if (tErr) throw new HttpError(500, tErr.message);
    if (!target || target.tenant_id !== caller.tenant_id) {
      throw new HttpError(404, "User not found in your tenant.");
    }

    const { error: profErr } = await admin
      .from("profile")
      .update({ status: "disabled" })
      .eq("id", userId);
    if (profErr) throw new HttpError(500, profErr.message);

    // Ban at the auth layer (~100 years) to block sign-in immediately.
    const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: "876000h",
    });
    if (banErr) throw new HttpError(500, banErr.message);

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
