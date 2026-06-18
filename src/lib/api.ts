import { supabase } from "./supabase";
import type { AppRole } from "./types";

/**
 * Thin wrapper around the server-only /api endpoints. Always attaches the
 * caller's Supabase access token so the serverless function can verify the
 * caller's identity and role before using the service-role key.
 */
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

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
  } & T;

  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status}).`);
  }
  return json;
}

export interface InviteUserInput {
  email: string;
  fullName: string;
  role: AppRole;
}

export function inviteUser(input: InviteUserInput) {
  return authedFetch<{ ok: true; userId: string }>("/api/invite", input);
}

export function disableUser(userId: string) {
  return authedFetch<{ ok: true }>("/api/disable-user", { userId });
}
