import { type ReactNode } from "react";
import { BrandLogo } from "./BrandLogo";

/**
 * Centered layout for the public / pre-authenticated pages (login,
 * forgot/reset password, accept invite). Carries the Venakan Info Solutions
 * company brand beneath the card.
 */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-mist/50 p-4">
      {children}
      <footer className="flex flex-col items-center gap-1">
        <BrandLogo className="h-7 opacity-80" />
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} Venakan Info Solutions
        </p>
      </footer>
    </div>
  );
}
