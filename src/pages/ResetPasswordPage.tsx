import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Check, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { isPasswordValid, passwordChecks } from "@/lib/password";
import { AuthScreen } from "@/components/layout/AuthScreen";
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
 * Reached via the password-reset email link. Supabase establishes a recovery
 * session from the URL (detectSessionInUrl). The user sets a new password; we
 * then sign them out and send them back to /login to sign in fresh.
 */
export function ResetPasswordPage() {
  const { session, signOut } = useAuth();
  const [, navigate] = useLocation();

  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Give Supabase a tick to parse the recovery token from the URL hash.
    const t = setTimeout(() => setChecking(false), 600);
    return () => clearTimeout(t);
  }, []);

  const checks = passwordChecks(password);
  const matches = password.length > 0 && password === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isPasswordValid(password)) {
      setError("Your password does not meet the requirements below.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) throw pwError;

      // Send the user back to sign in with the new password.
      await signOut();
      navigate("/login");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not set your password.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const noSession = !checking && !session;

  return (
    <AuthScreen>
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3">
          <Wordmark className="text-lg" />
          <div>
            <CardTitle>Set a new password</CardTitle>
            <CardDescription>
              Choose a new password for your Venakan Learn account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {noSession ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This reset link is invalid or has expired. Request a new one
                from the sign-in screen.
              </p>
              <Button asChild className="w-full">
                <Link href="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
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
                <Label htmlFor="confirm">Re-enter new password</Label>
                <Input
                  id="confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              <ul className="space-y-1 text-sm">
                {checks.map((c) => (
                  <Requirement key={c.label} ok={c.ok} label={c.label} />
                ))}
                <Requirement
                  ok={matches}
                  label="Both passwords match"
                />
              </ul>

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
                {submitting ? "Saving…" : "Save new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthScreen>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={
        ok ? "flex items-center gap-2 text-emerald-strong" : "flex items-center gap-2 text-muted-foreground"
      }
    >
      {ok ? (
        <Check className="h-4 w-4 shrink-0" />
      ) : (
        <X className="h-4 w-4 shrink-0 opacity-60" />
      )}
      {label}
    </li>
  );
}
