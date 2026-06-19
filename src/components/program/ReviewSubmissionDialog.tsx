import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, X, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { reviewSubmission, type AiGrade } from "@/lib/runtime";
import type { Rubric } from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ReviewTarget {
  submissionId: string;
  traineeName: string;
  moduleTitle: string;
}

interface ReviewSubmissionDialogProps {
  target: ReviewTarget | null;
  onOpenChange: (open: boolean) => void;
  onReviewed: () => void;
}

/**
 * Human trainer-review path (Prompt 5). Trainer/admin reads the trainee
 * artifact + the exercise rubric (via existing staff RLS on submission /
 * exercise), then Pass/Fail through the review_submission RPC. No <form>.
 */
export function ReviewSubmissionDialog({
  target,
  onOpenChange,
  onReviewed,
}: ReviewSubmissionDialogProps) {
  const [artifact, setArtifact] = useState<string | null>(null);
  const [rubric, setRubric] = useState<Rubric | null>(null);
  const [aiGrade, setAiGrade] = useState<AiGrade | null>(null);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState("");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (submissionId: string) => {
    setLoading(true);
    setError(null);
    setArtifact(null);
    setRubric(null);
    setAiGrade(null);
    // Staff RLS lets trainers/admins read the submission + exercise directly.
    const { data: sub, error: subErr } = await supabase
      .from("submission")
      .select("id, artifact, exercise_id, ai_grade")
      .eq("id", submissionId)
      .maybeSingle();
    if (subErr) {
      setError(subErr.message);
      setLoading(false);
      return;
    }
    setArtifact((sub?.artifact as string | null) ?? null);
    setAiGrade((sub?.ai_grade as AiGrade | null) ?? null);
    if (sub?.exercise_id) {
      const { data: ex, error: exErr } = await supabase
        .from("exercise")
        .select("rubric")
        .eq("id", sub.exercise_id)
        .maybeSingle();
      if (exErr) setError(exErr.message);
      else setRubric((ex?.rubric as Rubric | null) ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (target) {
      setScore("");
      setFeedback("");
      void load(target.submissionId);
    }
  }, [target, load]);

  function acceptAiGrade() {
    if (!aiGrade) return;
    if (typeof aiGrade.score === "number") setScore(String(aiGrade.score));
    setFeedback(aiGrade.note ?? "");
  }

  const hasAiGrade =
    aiGrade != null &&
    (aiGrade.status === "graded" ||
      aiGrade.status === "needs_manual_review" ||
      aiGrade.status === "error");

  async function decide(decision: "passed" | "failed") {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const grade: Record<string, unknown> = { feedback: feedback.trim() };
      const n = Number(score);
      if (score.trim() !== "" && !Number.isNaN(n)) grade.score = n;
      await reviewSubmission(target.submissionId, decision, grade);
      onOpenChange(false);
      onReviewed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review submission</DialogTitle>
          <DialogDescription>
            {target ? `${target.traineeName} · ${target.moduleTitle}` : ""}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Trainee artifact */}
            <div className="space-y-1.5">
              <Label>Trainee submission</Label>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-mist/50 p-3 font-mono text-xs text-ink">
                {artifact && artifact.trim()
                  ? artifact
                  : "(empty submission)"}
              </pre>
            </div>

            {/* Rubric */}
            {rubric?.criteria?.length ? (
              <div className="space-y-1.5">
                <Label>Rubric</Label>
                <ul className="space-y-1 rounded-md border border-border p-3 text-xs">
                  {rubric.criteria.map((c, i) => (
                    <li key={i} className="text-ink/80">
                      <span className="font-medium">{c.name}</span>
                      {typeof c.weight === "number"
                        ? ` (${Math.round(c.weight * 100)}%)`
                        : ""}
                      {c.description ? ` — ${c.description}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {/* AI advisory — NOT authoritative. The trainer decision is final. */}
            {hasAiGrade && aiGrade && (
              <div className="space-y-2 rounded-md border border-emerald/30 bg-emerald/5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                    <Sparkles className="h-3.5 w-3.5 text-emerald-strong" />
                    AI grade (advisory)
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={acceptAiGrade}
                    disabled={submitting}
                  >
                    Accept AI grade
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  This grade is advisory only. Your Pass/Fail decision below is
                  final.
                </p>
                {(typeof aiGrade.score === "number" || aiGrade.note) && (
                  <p className="text-xs text-ink/90">
                    {typeof aiGrade.score === "number"
                      ? `Score ${aiGrade.score}/${aiGrade.max_score ?? 100}. `
                      : ""}
                    {aiGrade.note ?? ""}
                  </p>
                )}
                {aiGrade.status !== "graded" && (
                  <p className="text-xs text-amber-700">
                    Status: {aiGrade.status.replace(/_/g, " ")}
                    {aiGrade.error ? ` — ${aiGrade.error}` : ""}
                  </p>
                )}
                {aiGrade.dimensions && aiGrade.dimensions.length > 0 && (
                  <ul className="space-y-0.5">
                    {aiGrade.dimensions.map((d, i) => (
                      <li key={i} className="text-xs text-ink/80">
                        <span className="font-medium">{d.name}</span> — {d.score}/
                        {d.max}
                        {d.comment ? ` · ${d.comment}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {aiGrade.output &&
                  (aiGrade.output.test_results ||
                    aiGrade.output.metrics ||
                    aiGrade.output.traces ||
                    aiGrade.output.stdout ||
                    aiGrade.output.stderr) && (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Captured sandbox output
                      </summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-mist/70 p-2 font-mono text-[11px] text-ink/80">
                        {aiGrade.output.metrics
                          ? `metrics: ${JSON.stringify(aiGrade.output.metrics, null, 2)}\n`
                          : ""}
                        {aiGrade.output.test_results
                          ? `tests: ${JSON.stringify(aiGrade.output.test_results, null, 2)}\n`
                          : ""}
                        {aiGrade.output.traces
                          ? `traces: ${JSON.stringify(aiGrade.output.traces, null, 2)}\n`
                          : ""}
                        {aiGrade.output.stdout
                          ? `stdout:\n${aiGrade.output.stdout}\n`
                          : ""}
                        {aiGrade.output.stderr
                          ? `stderr:\n${aiGrade.output.stderr}`
                          : ""}
                      </pre>
                    </details>
                  )}
                {aiGrade.judge_rubric_version && (
                  <p className="text-[10px] text-muted-foreground">
                    rubric snapshot {aiGrade.judge_rubric_version.slice(0, 12)}…
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="review-score">Score</Label>
                <Input
                  id="review-score"
                  inputMode="numeric"
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  placeholder="e.g. 85"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="review-feedback">Feedback</Label>
                <Textarea
                  id="review-feedback"
                  className="min-h-24"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What went well, what to improve…"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="destructive"
            onClick={() => decide("failed")}
            disabled={submitting || loading}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
            Fail
          </Button>
          <Button
            type="button"
            onClick={() => decide("passed")}
            disabled={submitting || loading}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Pass
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
