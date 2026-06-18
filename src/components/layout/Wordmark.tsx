import { cn } from "@/lib/utils";

/** Venakan Learn wordmark — near-black "Venakan" + emerald "Learn". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "select-none text-base font-semibold tracking-tight text-ink",
        className,
      )}
    >
      Venakan
      <span className="text-emerald-strong"> Learn</span>
    </span>
  );
}
