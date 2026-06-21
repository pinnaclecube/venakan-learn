import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useParams, Link } from "wouter";
import {
  Loader2,
  ArrowLeft,
  Lock,
  CheckCircle2,
  Send,
  Play,
  RotateCcw,
  Monitor,
  ExternalLink,
  Info,
} from "lucide-react";
import {
  getTraineeProgram,
  submitAndGrade,
  runExercise,
  type TraineeProgram,
  type TraineeModule,
  type RuntimeExercise,
  type RuntimeSubmission,
  type AiGrade,
  type SubmitAndGradeResult,
  type RunExerciseResult,
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
import { RunConsole } from "@/components/learning/RunConsole";

// Heavy editor is lazy-loaded so it stays out of the initial bundle.
const CodeEditor = lazy(() => import("@/components/learning/CodeEditor"));

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

function outcomeMessage(r: SubmitAndGradeResult): string {
  if (r.aiGrade.status === "error") {
    return "Grading ran into an issue — your work was sent for manual review.";
  }
  if (r.aiGrade.status === "needs_manual_review") {
    return "Sent for manual review.";
  }
  if (r.gate.advanced && r.gate.enrollment_status === "completed") {
    return "Passed — you have completed the program!";
  }
  if (r.gate.advanced) {
    return "Passed — the next module is unlocked.";
  }
  if (r.gate.enrollment_status === "awaiting_review") {
    return "Submitted — awaiting trainer review.";
  }
  if (r.gate.gate_status === "failed") {
    return "Not passed yet — review the feedback and resubmit.";
  }
  return "Submitted.";
}

// --- AI grade renderer (advisory for trainer gates) ------------------------
function AiGradeView({ grade }: { grade: AiGrade }) {
  const o = grade.output;
  return (
    <div className="space-y-2 rounded-md border border-border bg-mist/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">AI grade</p>
        {typeof grade.score === "number" && (
          <span className="text-xs font-medium text-emerald-strong">
            {grade.score}/{grade.max_score ?? 100}
          </span>
        )}
      </div>
      {grade.note && <p className="text-xs text-ink/80">{grade.note}</p>}
      {grade.dimensions && grade.dimensions.length > 0 && (
        <ul className="space-y-0.5">
          {grade.dimensions.map((d, i) => (
            <li key={i} className="text-xs text-ink/80">
              <span className="font-medium">{d.name}</span> — {d.score}/{d.max}
              {d.comment ? ` · ${d.comment}` : ""}
            </li>
          ))}
        </ul>
      )}
      {o && (o.test_results || o.metrics || o.stdout || o.stderr) && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Captured output
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-mist/70 p-2 font-mono text-[11px] text-ink/80">
            {o.metrics
              ? `metrics: ${JSON.stringify(o.metrics, null, 2)}\n`
              : ""}
            {o.test_results
              ? `tests: ${JSON.stringify(o.test_results, null, 2)}\n`
              : ""}
            {o.stdout ? `stdout:\n${o.stdout}\n` : ""}
            {o.stderr ? `stderr:\n${o.stderr}` : ""}
          </pre>
        </details>
      )}
    </div>
  );
}

// --- Small UI bits ---------------------------------------------------------
function DeliveryBadge({ delivery }: { delivery?: "in_app" | "external" }) {
  if (delivery === "external") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
        <ExternalLink className="h-3 w-3" /> Your environment
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald/40 bg-emerald/10 px-2 py-0.5 text-[11px] font-medium text-emerald-strong">
      <Monitor className="h-3 w-3" /> In the app
    </span>
  );
}

const ONBOARD_KEY = "venakan:onboard:exercises";

function ExerciseOnboarding() {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ONBOARD_KEY) === "1";
    } catch {
      return false;
    }
  });
  if (dismissed) return null;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-md border border-border bg-mist/60 p-3">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-emerald-strong" />
      <div className="flex-1 text-xs">
        <p className="text-sm font-medium text-ink">How exercises work</p>
        <p className="mt-0.5 text-muted-foreground">
          <span className="font-medium text-ink">In the app</span> exercises are
          done right here — write your solution, <span className="font-medium">Run</span>{" "}
          to check it, then <span className="font-medium">Submit</span> to be
          graded. <span className="font-medium text-ink">Your environment</span>{" "}
          exercises are built in your own tools and submitted by link for review.
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.setItem(ONBOARD_KEY, "1");
          } catch {
            /* ignore */
          }
          setDismissed(true);
        }}
        className="text-xs font-medium text-muted-foreground hover:text-ink"
      >
        Got it
      </button>
    </div>
  );
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
  onSubmitted: (r: SubmitAndGradeResult) => void;
}) {
  const draftKey = `venakan:draft:${exercise.id}`;
  const starter = exercise.starter_code ?? "";

  const [artifact, setArtifact] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved !== null) return saved;
    } catch {
      /* ignore */
    }
    return starter;
  });
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<RunExerciseResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const isCodeArea =
    exercise.type === "code" ||
    exercise.type === "rag" ||
    exercise.type === "agent";
  const canRun = isCodeArea && exercise.run_enabled === true && !locked;
  const editorLanguage =
    exercise.language ?? (isCodeArea ? "javascript" : "text");

  // Autosave the draft so work is never lost on reload / navigation.
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, artifact);
    } catch {
      /* ignore quota / privacy mode */
    }
  }, [draftKey, artifact]);

  function resetToStarter() {
    setArtifact(starter);
    setRunResult(null);
    setRunError(null);
  }

  async function handleSubmit() {
    if (locked || !artifact.trim()) return;
    setSubmitting(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await submitAndGrade(exercise.id, artifact);
      setArtifact(starter);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setRunResult(null);
      setRunError(null);
      setOutcome(outcomeMessage(result));
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRun() {
    if (!canRun || running || !artifact.trim()) return;
    setRunning(true);
    setRunError(null);
    setRunResult(null);
    try {
      setRunResult(await runExercise(exercise.id, artifact));
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Run failed.");
    } finally {
      setRunning(false);
    }
  }

  // Cmd/Ctrl+Enter → Run (or Submit when there's nothing to run).
  function onWorkKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (canRun) void handleRun();
      else void handleSubmit();
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
          <div className="flex items-center gap-2">
            <DeliveryBadge delivery={exercise.delivery} />
            <Badge variant="muted">{EXERCISE_TYPE_LABELS[exercise.type]}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={
            isCodeArea && !locked ? "grid gap-4 lg:grid-cols-2" : "space-y-4"
          }
        >
          {/* Prompt + rubric */}
          <div className="space-y-3">
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
          </div>

          {/* Work area */}
          {locked ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Submissions open when this is your
              current module.
            </p>
          ) : (
            <div className="space-y-2" onKeyDownCapture={onWorkKeyDown}>
              {isCodeArea ? (
                <Suspense
                  fallback={
                    <div className="flex h-40 items-center justify-center rounded-md border border-border bg-mist/40 text-xs text-muted-foreground">
                      Loading editor…
                    </div>
                  }
                >
                  <CodeEditor
                    value={artifact}
                    onChange={setArtifact}
                    language={editorLanguage}
                    placeholder="Write your solution here…"
                  />
                </Suspense>
              ) : (
                <Textarea
                  value={artifact}
                  onChange={(e) => setArtifact(e.target.value)}
                  placeholder="Write your response here…"
                  className="min-h-40"
                />
              )}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {canRun && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRun}
                    disabled={running || submitting || !artifact.trim()}
                  >
                    {running ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Running…
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4" /> Run
                      </>
                    )}
                  </Button>
                )}
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || running || !artifact.trim()}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Grading in
                      progress…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" /> Submit
                    </>
                  )}
                </Button>
                {isCodeArea && starter && artifact !== starter && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resetToStarter}
                    disabled={submitting || running}
                  >
                    <RotateCcw className="h-4 w-4" /> Reset
                  </Button>
                )}
              </div>
              {isCodeArea && (
                <p className="text-[11px] text-muted-foreground">
                  {canRun
                    ? "Run = quick check (not recorded) · Submit = graded · ⌘/Ctrl+Enter to run"
                    : "Submit when you’re ready — your work is graded. ⌘/Ctrl+Enter to submit"}
                </p>
              )}
              {(runResult || runError) && (
                <RunConsole result={runResult} error={runError} />
              )}
              {outcome && (
                <p className="text-xs font-medium text-ink" role="status">
                  {outcome}
                </p>
              )}
            </div>
          )}
        </div>

        {/* History for this exercise */}
        {mine.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Your submissions
            </p>
            {mine.map((s) => {
              const tfb = feedbackOf(s.trainer_grade);
              const tscore = scoreOf(s.trainer_grade);
              const ai = s.ai_grade as AiGrade;
              const hasGrade =
                ai &&
                (ai.status === "graded" ||
                  ai.status === "needs_manual_review" ||
                  ai.status === "error");
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
                  {ai?.status === "grading" && (
                    <p className="mt-1 text-muted-foreground">
                      Grading in progress…
                    </p>
                  )}
                  {hasGrade && (
                    <div className="mt-1.5">
                      <AiGradeView grade={ai} />
                    </div>
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
    (r: SubmitAndGradeResult) => {
      setFlash(outcomeMessage(r));
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

      <ExerciseOnboarding />

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
