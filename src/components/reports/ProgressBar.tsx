interface ProgressBarProps {
  /** 0–100. */
  value: number;
  label?: string;
  /** Hide the trailing percent label. */
  hideLabel?: boolean;
  className?: string;
}

/** Emerald fill on a mist track. Accessible progressbar with percent label. */
export function ProgressBar({
  value,
  label,
  hideLabel,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label ?? `${pct}% complete`}
          className="h-2 w-full overflow-hidden rounded-full bg-mist"
        >
          <div
            className="h-full rounded-full bg-emerald-strong transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        {!hideLabel && (
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {pct}%
          </span>
        )}
      </div>
    </div>
  );
}
