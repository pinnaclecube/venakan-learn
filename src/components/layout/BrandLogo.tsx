import { useState } from "react";
import { cn } from "@/lib/utils";

/** Drop-in path for the official asset. Replace public/venakan-info-logo.svg. */
const LOGO_SRC = "/venakan-info-logo.svg";

/**
 * Venakan Info Solutions company logo. Renders the supplied asset at
 * `/venakan-info-logo.svg`; if that file is ever missing, falls back to an
 * on-brand text lockup so the UI never shows a broken image.
 */
export function BrandLogo({ className }: { className?: string }) {
  const [ok, setOk] = useState(true);

  if (!ok) return <BrandLogoFallback className={className} />;

  return (
    <img
      src={LOGO_SRC}
      alt="Venakan Info Solutions"
      onError={() => setOk(false)}
      className={cn("h-8 w-auto select-none", className)}
    />
  );
}

function BrandLogoFallback({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "flex select-none flex-col items-center leading-none text-ink",
        className,
      )}
      aria-label="Venakan Info Solutions"
    >
      <span className="text-base font-extrabold tracking-[0.18em]">VENAKAN</span>
      <span className="mt-0.5 text-[9px] font-medium tracking-[0.32em] text-foreground/70">
        INFO SOLUTIONS
      </span>
    </span>
  );
}
