import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, Link } from "wouter";
import {
  Loader2,
  ArrowLeft,
  Lock,
  CheckCircle2,
  Send,
  Play,
} from "lucide-react";
import {
  getTraineeProgram,
  submitExercise,
  AUTO_GRADE_ENABLED,
  type TraineeProgram,
  type TraineeModule,
  type RuntimeExercise,
  type RuntimeSubmission,
  type SubmitResult,
} from "@/lib/runtime";
import { EXERCISE_TYPE_LABELS, GATE_TYPE_LABELS } from "@/lib/generation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { GateStatusBadge } from "@/components/reports/StatusBadge";
import { LessonBlocks } from "@/components/learning/LessonBlocks";
import { ProgressRail } from "@/components/learning/ProgressRail";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function feedbackOf(grade: Record<string, unknown>): string | null {
  const fb = grade?.["feedback"];
  return typeof fb === "string" && fb.trim() ? fb : null;
}
function scoreOf(grade: Record<string, unknown>): string | null {
  const sc = grade?.["score"];
  if (typeof sc === "number") return String(sc);
  if (typeof sc === "string" && sc.trim()) return sc;
  return null;
}

// --- Exercise submission surface -------------------------------------------
function ExerciseCard({
  exercise,
  locked,
  submissions,
  onSubmitted,
}: {
  exercise: RuntimeExercise;
  locked: boolean;
  submissions: RuntimeSubmission[];
  onSubmitted: (r: SubmitResult) => void;
}) {
  const [artifact, setArtifact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCodeArea =
    exercise.type === "code" ||
    exercise.type === "rag" ||
    exercise.type === "agent";

  async function handleSubmit() {
    if (locked || !artifact.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitExercise(exercise.id, artifact);
      setArtifact("");
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const mine = submissions
    .filter((s) => s.exercise_id === exercise.id)
    .sort((a, b) => (b.submitted_at ?? "").localeCompare(a.submitted_at ?? ""));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {EXERCISE_TYPE_LABELS[exercise.type]} exercise
          </CardTitle>
          <Badge variant="muted">{EXERCISE_TYPE_LABELS[exercise.type]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap text-sm text-ink/90">
          {exercise.prompt}
        </p>

        {exercise.rubric?.criteria?.length > 0 && (
          <div className="rounded-md border border-border bg-mist/50 p-3">
            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
              Graded on
            </p>
            <ul className="space-y-1">
              {exercise.rubric.criteria.map((c, i) => (
                <li key={i} className="text-xs text-ink/80">
                  <span className="font-medium">{c.name}</span>
                  {c.description ? ` — ${c.description}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Submission surface */}
        {locked ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Submissions open when this is your
            current module.
          </p>
        ) : (
          <div className="space-y-2">
            <Textarea
              value={artifact}
              onChange={(e) => setArtifact(e.target.value)}
              placeholder={
                isCodeArea
                  ? "Paste your solution here…"
                  : "Write your response here…"
              }
              className={
                "min-h-40 " + (isCodeArea ? "font-mono text-xs" : "")
              }
            />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !artifact.trim()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Submit
                  </>
                )}
              </Button>
              {isCodeArea && !AUTO_GRADE_ENABLED && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Play className="h-3.5 w-3.5" /> Run — available soon
                </span>
              )}
            </div>
          </div>
        )}

        {/* History for this exercise */}
        {mine.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Your submissions
            </p>
            {mine.map((s) => {
              const tfb = feedbackOf(s.trainer_grade);
              const tscore = scoreOf(s.trainer_grade);
              const aiNote =
                typeof s.ai_grade?.["note"] === "string"
                  ? (s.ai_grade["note"] as string)
                  : null;
              return (
                <div
                  key={s.id}
                  className="rounded-md border border-border p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {fmtDate(s.submitted_at)}
                    </span>
                    <GateStatusBadge status={s.gate_status} />
                  </div>
                  {aiNote && (
                    <p className="mt-1 text-muted-foreground">{aiNote}</p>
                  )}
                  {(tfb || tscore) && (
                    <div className="mt-1.5 rounded bg-mist/60 p-2">
                      <p className="font-medium text-ink">
                        Trainer feedback
                        {tscore ? ` · score ${tscore}` : ""}
                      </p>
                      {tfb && <p className="mt-0.5 text-ink/80">{tfb}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function LearningRuntimePage() {
  const params = useParams<{ programId: string }>();
  const programId = params.programId;

  const [data, setData] = useState<TraineeProgram | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await getTraineeProgram(programId);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load program.");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentOrder = data?.enrollment?.current_module_order ?? 0;
  const modules = useMemo(() => data?.modules ?? [], [data]);
  const submissions = useMemo(
    () => data?.my_submissions ?? [],
    [data],
  );

  // Default selection to the current module once loaded.
  useEffect(() => {
    if (selectedOrder !== null || modules.length === 0) return;
    const cur = modules.find((m) => m.order === currentOrder);
    setSelectedOrder((cur ?? modules[0]).order);
  }, [modules, currentOrder, selectedOrder]);

  const selectedModule: TraineeModule | null = useMemo(() => {
    if (selectedOrder === null) return null;
    return modules.find((m) => m.order === selectedOrder) ?? null;
  }, [modules, selectedOrder]);

  const handleSubmitted = useCallback(
    (r: SubmitResult) => {
      if (r.advanced && r.enrollment_status === "completed") {
        setFlash("Submitted — you have completed the program!");
      } else if (r.advanced) {
        setFlash("Submitted and passed — the next module is unlocked.");
      } else if (r.note) {
        setFlash(`Submitted — ${r.note}.`);
      } else {
        setFlash("Submitted.");
      }
      void load();
    },
    [load],
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Program" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Program" />
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Link
          href="/trainee/learning"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-strong"
        >
          <ArrowLeft className="h-4 w-4" /> Back to My Learning
        </Link>
      </div>
    );
  }

  if (!data || !data.enrolled) {
    return (
      <div>
        <PageHeader title="Program" />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You are not enrolled in this program.
          </CardContent>
        </Card>
        <Link
          href="/trainee/learning"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-emerald-strong"
        >
          <ArrowLeft className="h-4 w-4" /> Back to My Learning
        </Link>
      </div>
    );
  }

  const selectedLocked =
    selectedModule !== null && selectedModule.order > currentOrder;
  const completed = data.enrollment?.status === "completed";

  return (
    <div>
      <Link
        href="/trainee/learning"
        className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> My Learning
      </Link>
      <PageHeader
        title={data.program?.title ?? "Program"}
        description={`${modules.length} modules · ${data.program?.week_count ?? 0} weeks`}
      />

      {completed && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-emerald/30 bg-emerald/10 p-3 text-sm text-ink">
          <CheckCircle2 className="h-4 w-4 text-emerald-strong" /> You have
          completed every module in this program.
        </div>
      )}

      {flash && (
        <div className="mb-4 rounded-md border border-border bg-mist p-3 text-sm text-ink">
          {flash}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        {/* Progress rail */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <ProgressRail
            modules={modules}
            currentOrder={currentOrder}
            selectedOrder={selectedOrder ?? currentOrder}
            onSelect={setSelectedOrder}
          />
        </aside>

        {/* Module body */}
        <div className="min-w-0 space-y-6">
          {!selectedModule ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                This program has no modules yet.
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      Module {selectedModule.order}: {selectedModule.title}
                    </CardTitle>
                    <Badge variant="outline">
                      {GATE_TYPE_LABELS[selectedModule.gate_type]}
                    </Badge>
                  </div>
                  {selectedModule.objectives.length > 0 && (
                    <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                      {selectedModule.objectives.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  )}
                </CardHeader>
                <CardContent>
                  <LessonBlocks blocks={selectedModule.lesson} />
                </CardContent>
              </Card>

              {selectedModule.exercises.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-ink">Exercises</h3>
                  {selectedLocked && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Lock className="h-3.5 w-3.5" /> Complete earlier modules
                      to unlock this one.
                    </p>
                  )}
                  {selectedModule.exercises.map((ex) => (
                    <ExerciseCard
                      key={ex.id}
                      exercise={ex}
                      locked={selectedLocked}
                      submissions={submissions}
                      onSubmitted={handleSubmitted}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
