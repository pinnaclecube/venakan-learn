import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCaller, HttpError } from "./_auth.js";

/**
 * Called by the profile-settings page. Lets any authenticated user update
 * their OWN profile (currently just full_name). Profile writes are admin-only
 * under RLS, so this runs through the service-role client but is hard-scoped to
 * the caller's own id.
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
    const { admin, caller } = await getCaller(req);
    const { fullName } = (req.body ?? {}) as { fullName?: string };
    const cleanName = (fullName ?? "").trim();

    if (!cleanName) throw new HttpError(400, "Full name is required.");

    const { error: profErr } = await admin
      .from("profile")
      .update({ full_name: cleanName })
      .eq("id", caller.id);
    if (profErr) throw new HttpError(500, profErr.message);

    // Keep the auth user_metadata in sync (used by the invite/recovery flows).
    await admin.auth.admin.updateUserById(caller.id, {
      user_metadata: { full_name: cleanName },
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
