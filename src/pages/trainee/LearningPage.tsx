import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";
import { Loader2, ArrowRight } from "lucide-react";
import {
  myEnrolledPrograms,
  type EnrolledProgramRow,
} from "@/lib/runtime";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { ProgressBar } from "@/components/reports/ProgressBar";
import { EnrollmentStatusBadge } from "@/components/reports/StatusBadge";

/**
 * Trainee landing for delivery (Prompt 5). Lists the trainee's enrolled,
 * published programs. Data comes from the my_enrolled_programs() SECURITY
 * DEFINER RPC — trainees never read program/module tables directly.
 */
export function LearningPage() {
  const [programs, setPrograms] = useState<EnrolledProgramRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPrograms(await myEnrolledPrograms());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load programs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="My Learning" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="My Learning"
        description="Your assigned training programs. Open one to start working through its modules."
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {programs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no assigned programs yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {programs.map((p) => {
            const pct =
              p.total_modules > 0
                ? Math.min(
                    100,
                    Math.round(
                      (p.current_module_order / p.total_modules) * 100,
                    ),
                  )
                : 0;
            return (
              <Link
                key={p.program_id}
                href={`/trainee/learning/${p.program_id}`}
                className="block rounded-lg border border-border bg-card p-5 shadow-sm transition-colors hover:border-emerald hover:bg-mist/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">
                      {p.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {p.week_count} week{p.week_count === 1 ? "" : "s"} ·{" "}
                      {p.total_modules} module
                      {p.total_modules === 1 ? "" : "s"}
                    </p>
                  </div>
                  <EnrollmentStatusBadge status={p.status} />
                </div>
                <div className="mt-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Progress</span>
                    <span>{pct}%</span>
                  </div>
                  <ProgressBar value={pct} hideLabel />
                </div>
                <div className="mt-4 flex items-center gap-1 text-sm font-medium text-emerald-strong">
                  Continue <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
