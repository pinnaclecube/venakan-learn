import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loud in dev; these must be set in .env / Vercel env.
  // The anon key is RLS-gated and safe to ship to the browser.
  throw new Error(
    "Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).",
  );
}

/**
 * Browser Supabase client. Uses the anon key only — every query is gated by
 * Row-Level Security. The service-role key is NEVER imported here; it lives
 * exclusively in /api serverless functions.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
