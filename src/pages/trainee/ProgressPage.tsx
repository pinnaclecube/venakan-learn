import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Check, Circle, Lock, Trophy } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  type EnrollmentStatus,
  type GateStatus,
  type CohortStanding,
} from "@/lib/reporting";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GateStatusBadge } from "@/components/reports/StatusBadge";
import { DistributionChart } from "@/components/reports/DistributionChart";

interface MyEnrollment {
  id: string;
  program_id: string;
  current_module_order: number;
  status: EnrollmentStatus;
}

interface MyModule {
  id: string;
  program_id: string;
  order: number;
  title: string;
}

interface MySubmission {
  id: string;
  module_id: string | null;
  gate_status: GateStatus;
  ai_grade: Record<string, unknown>;
  trainer_grade: Record<string, unknown>;
}

function feedbackText(s: MySubmission): string | null {
  const tg = s.trainer_grade ?? {};
  const ag = s.ai_grade ?? {};
  const fromTrainer =
    typeof tg["feedback"] === "string" ? (tg["feedback"] as string) : null;
  const fromAi =
    typeof ag["feedback"] === "string" ? (ag["feedback"] as string) : null;
  return fromTrainer ?? fromAi;
}

export function ProgressPage() {
  const [enrollment, setEnrollment] = useState<MyEnrollment | null>(null);
  const [modules, setModules] = useState<MyModule[]>([]);
  const [submissions, setSubmissions] = useState<MySubmission[]>([]);
  const [standing, setStanding] = useState<CohortStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Own enrollments (RLS limits to the caller's candidate). Pick most recent.
    const enrRes = await supabase
      .from("enrollment")
      .select("id, program_id, current_module_order, status, started_at, created_at")
      .order("created_at", { ascending: false });

    if (enrRes.error) {
      setError(enrRes.error.message);
      setLoading(false);
      return;
    }

    const enrollments = (enrRes.data as unknown as (MyEnrollment & {
      started_at: string | null;
      created_at: string;
    })[]) ?? [];
    const current = enrollments[0] ?? null;
    setEnrollment(current);

    if (current) {
      const [modRes, subRes] = await Promise.all([
        supabase
          .from("module")
          .select("id, program_id, \"order\", title")
          .eq("program_id", current.program_id)
          .order("order", { ascending: true }),
        supabase
          .from("submission")
          .select("id, module_id, gate_status, ai_grade, trainer_grade")
          .eq("enrollment_id", current.id),
      ]);
      if (modRes.error) setError(modRes.error.message);
      else setModules((modRes.data as unknown as MyModule[]) ?? []);
      if (subRes.error) setError(subRes.error.message);
      else setSubmissions((subRes.data as unknown as MySubmission[]) ?? []);
    } else {
      setModules([]);
      setSubmissions([]);
    }

    // Anonymized standing via the single RPC.
    const rpcRes = await supabase.rpc("my_cohort_standing");
    if (rpcRes.error) setError(rpcRes.error.message);
    else setStanding((rpcRes.data as unknown as CohortStanding) ?? null);

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submissionsByModule = useMemo(() => {
    const m = new Map<string, MySubmission[]>();
    for (const s of submissions) {
      if (!s.module_id) continue;
      const arr = m.get(s.module_id) ?? [];
      arr.push(s);
      m.set(s.module_id, arr);
    }
    return m;
  }, [submissions]);

  if (loading) {
    return (
      <div>
        <PageHeader title="My Progress" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="My Progress"
        description="Your journey through the program and how you stand in your cohort."
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* My journey */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">My journey</CardTitle>
        </CardHeader>
        <CardContent>
          {!enrollment || modules.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You'll see your modules here once you're enrolled in a program.
            </p>
          ) : (
            <ol className="space-y-3">
              {modules.map((m) => {
                const done = m.order < enrollment.current_module_order;
                const isCurrent = m.order === enrollment.current_module_order;
                const subs = submissionsByModule.get(m.id) ?? [];
                return (
                  <li
                    key={m.id}
                    className={
                      "flex gap-3 rounded-md border p-3 " +
                      (isCurrent
                        ? "border-emerald bg-emerald/5"
                        : "border-border")
                    }
                  >
                    <div className="mt-0.5 shrink-0">
                      {done ? (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-strong text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      ) : isCurrent ? (
                        <Circle className="h-5 w-5 text-emerald-strong" />
                      ) : (
                        <Lock className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={
                            "text-sm font-medium " +
                            (done || isCurrent ? "text-ink" : "text-muted-foreground")
                          }
                        >
                          M{m.order}: {m.title}
                        </p>
                        {subs.length > 0 && (
                          <GateStatusBadge status={subs[0].gate_status} />
                        )}
                      </div>
                      {subs.map((s) => {
                        const fb = feedbackText(s);
                        return fb ? (
                          <p
                            key={s.id}
                            className="mt-1 text-xs text-muted-foreground"
                          >
                            {fb}
                          </p>
                        ) : null;
                      })}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* My standing (anonymized) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Trophy className="h-4 w-4 text-emerald-strong" /> My standing
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Anonymized — no other trainee's name or score is shown.
          </p>
        </CardHeader>
        <CardContent>
          {!standing || !standing.enrolled ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You'll see your standing once you're enrolled and have submissions.
            </p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-2xl font-semibold text-ink">
                    Top {standing.percentile_top}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Rank {standing.my_rank} of {standing.cohort_size}
                  </p>
                </div>
                <div>
                  <p className="text-2xl font-semibold text-ink">
                    {standing.my_score}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Gates passed
                  </p>
                </div>
              </div>
              <DistributionChart
                buckets={standing.distribution ?? []}
                myBucket={standing.my_bucket}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
