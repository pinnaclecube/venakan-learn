// Shared password-strength requirements, used by the reset-password and
// profile change-password flows so the rules stay in one place.

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

/**
 * The four requirements surfaced to the user: 8+ chars, one uppercase, one
 * lowercase, and one symbol (any non-alphanumeric character).
 */
export function passwordChecks(pw: string): PasswordCheck[] {
  return [
    { label: "At least 8 characters", ok: pw.length >= 8 },
    { label: "One uppercase letter", ok: /[A-Z]/.test(pw) },
    { label: "One lowercase letter", ok: /[a-z]/.test(pw) },
    { label: "One symbol", ok: /[^A-Za-z0-9]/.test(pw) },
  ];
}

export function isPasswordValid(pw: string): boolean {
  return passwordChecks(pw).every((c) => c.ok);
}

/** Basic RFC-ish email shape check for front-end validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
