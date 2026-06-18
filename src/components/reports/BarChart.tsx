export interface BarDatum {
  label: string;
  value: number;
  /** Optional secondary value shown to the right of the count (e.g. context). */
  hint?: string;
  /** Render this bar in emerald to call it out. */
  highlight?: boolean;
}

interface BarChartProps {
  data: BarDatum[];
  /** Shown when data is empty or all-zero. */
  emptyMessage?: string;
  className?: string;
}

/**
 * Minimal horizontal bar chart in pure CSS/divs — no chart library. Bars are
 * scaled to the max value in the set. Uses palette tokens (mist track, ink
 * bars, emerald for highlighted bars).
 */
export function BarChart({ data, emptyMessage, className }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const hasData = data.some((d) => d.value > 0);

  if (data.length === 0 || !hasData) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "No data yet."}
      </p>
    );
  }

  return (
    <div className={className}>
      <ul className="space-y-2">
        {data.map((d, i) => (
          <li key={`${d.label}-${i}`} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-xs text-muted-foreground">
              {d.label}
            </span>
            <div className="h-5 flex-1 overflow-hidden rounded-sm bg-mist">
              <div
                className={
                  "flex h-full items-center justify-end rounded-sm px-2 text-[11px] font-medium tabular-nums text-white transition-all " +
                  (d.highlight ? "bg-emerald-strong" : "bg-ink")
                }
                style={{ width: `${(d.value / max) * 100}%` }}
              >
                {d.value > 0 && d.value}
              </div>
            </div>
            {d.hint && (
              <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                {d.hint}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
