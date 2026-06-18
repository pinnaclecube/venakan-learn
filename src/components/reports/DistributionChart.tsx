import type { DistributionBucket } from "@/lib/reporting";

interface DistributionChartProps {
  buckets: DistributionBucket[];
  /** The caller's own bucket index — rendered in emerald. */
  myBucket?: number;
}

/**
 * Vertical histogram for the trainee cohort standing. Counts only — no
 * identities. The caller's own bucket is highlighted in emerald.
 */
export function DistributionChart({ buckets, myBucket }: DistributionChartProps) {
  if (buckets.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Not enough cohort data yet.
      </p>
    );
  }

  const max = Math.max(1, ...buckets.map((b) => b.count));

  return (
    <div>
      <div className="flex items-end gap-2" style={{ height: 140 }}>
        {buckets.map((b) => {
          const mine = b.bucket === myBucket;
          const h = (b.count / max) * 100;
          return (
            <div
              key={b.bucket}
              className="flex flex-1 flex-col items-center justify-end gap-1"
            >
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {b.count}
              </span>
              <div
                className={
                  "w-full rounded-t-sm transition-all " +
                  (mine ? "bg-emerald-strong" : "bg-mist")
                }
                style={{ height: `${Math.max(h, b.count > 0 ? 6 : 2)}%` }}
                title={mine ? "You are here" : undefined}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-2">
        {buckets.map((b) => (
          <div
            key={b.bucket}
            className={
              "flex-1 text-center text-[10px] " +
              (b.bucket === myBucket
                ? "font-semibold text-emerald-strong"
                : "text-muted-foreground")
            }
          >
            {b.label}
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        Passed-gate count per trainee (your bucket in emerald). Other trainees
        are anonymous.
      </p>
    </div>
  );
}
