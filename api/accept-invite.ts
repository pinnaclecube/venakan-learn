import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getCaller, HttpError } from "./_auth";

/**
 * Called by the accept-invite page after the user sets their password. Flips
 * the caller's own profile.status to 'active' and stamps the invitation.
 * Any authenticated user may activate ONLY their own profile.
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

    const { error: profErr } = await admin
      .from("profile")
      .update({
        status: "active",
        ...(cleanName ? { full_name: cleanName } : {}),
      })
      .eq("id", caller.id);
    if (profErr) throw new HttpError(500, profErr.message);

    // Best-effort: stamp the matching open invitation.
    await admin
      .from("invitation")
      .update({ accepted_at: new Date().toISOString() })
      .eq("tenant_id", caller.tenant_id)
      .eq("email", caller.email)
      .is("accepted_at", null);

    return res.status(200).json({ ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return res.status(status).json({ error: message });
  }
}
