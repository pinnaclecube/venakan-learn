import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Wordmark } from "@/components/layout/Wordmark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Reached via the invite email link. Supabase establishes a recovery/invite
 * session in the URL (detectSessionInUrl). The user sets a password; we then
 * flip profile.status -> active via the server-only /api/accept-invite.
 */
export function AcceptInvitePage() {
  const { session, refreshProfile } = useAuth();
  const [, navigate] = useLocation();

  const [checking, setChecking] = useState(true);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Give Supabase a tick to parse the invite token from the URL hash.
    const t = setTimeout(() => setChecking(false), 600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (session?.user.user_metadata?.full_name) {
      setFullName(String(session.user.user_metadata.full_name));
    }
  }, [session]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({
        password,
        data: { full_name: fullName.trim() },
      });
      if (pwError) throw pwError;

      const {
        data: { session: current },
      } = await supabase.auth.getSession();
      const res = await fetch("/api/accept-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${current?.access_token ?? ""}`,
        },
        body: JSON.stringify({ fullName: fullName.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || "Could not activate your account.");
      }

      await refreshProfile();
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set password.");
    } finally {
      setSubmitting(false);
    }
  }

  const noSession = !checking && !session;

  return (
    <div className="flex min-h-screen items-center justify-center bg-mist/50 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <Wordmark className="text-lg" />
          <div>
            <CardTitle>Set your password</CardTitle>
            <CardDescription>
              Finish setting up your Venakan Learn account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {noSession ? (
            <p className="text-sm text-muted-foreground">
              This invite link is invalid or has expired. Please ask an admin
              to resend your invitation.
            </p>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={submitting || checking}
              >
                {submitting ? "Activating…" : "Activate account"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
