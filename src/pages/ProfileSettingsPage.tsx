import { useEffect, useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { updateProfile } from "@/lib/api";
import { isPasswordValid, passwordChecks } from "@/lib/password";
import { ROLE_LABELS } from "@/lib/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ProfileSettingsPage() {
  const { profile, role, refreshProfile } = useAuth();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Profile settings"
        description="Manage your account details and password."
      />

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              Your email and role are managed by an administrator.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={profile?.email ?? ""} disabled readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <div>
                {role ? (
                  <Badge variant="success">{ROLE_LABELS[role]}</Badge>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <ProfileNameForm
          initialName={profile?.full_name ?? ""}
          onSaved={refreshProfile}
        />

        <ChangePasswordForm />
      </div>
    </div>
  );
}

function ProfileNameForm({
  initialName,
  onSaved,
}: {
  initialName: string;
  onSaved: () => Promise<void>;
}) {
  const [fullName, setFullName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setFullName(initialName);
  }, [initialName]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

    const clean = fullName.trim();
    if (!clean) {
      setError("Full name is required.");
      return;
    }

    setSubmitting(true);
    try {
      await updateProfile({ fullName: clean });
      await onSaved();
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setSubmitting(false);
    }
  }

  const dirty = fullName.trim() !== initialName.trim();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Update your display name.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                setDone(false);
              }}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-sm text-emerald-strong">Profile updated.</p>
          )}

          <Button type="submit" disabled={submitting || !dirty}>
            {submitting ? "Saving…" : "Save changes"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ChangePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const checks = passwordChecks(password);
  const matches = password.length > 0 && password === confirm;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);

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
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update your password.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setDone(false);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Re-enter new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setDone(false);
              }}
            />
          </div>

          <ul className="space-y-1 text-sm">
            {checks.map((c) => (
              <Requirement key={c.label} ok={c.ok} label={c.label} />
            ))}
            <Requirement ok={matches} label="Both passwords match" />
          </ul>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {done && (
            <p className="text-sm text-emerald-strong">Password updated.</p>
          )}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Update password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li
      className={
        ok
          ? "flex items-center gap-2 text-emerald-strong"
          : "flex items-center gap-2 text-muted-foreground"
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
