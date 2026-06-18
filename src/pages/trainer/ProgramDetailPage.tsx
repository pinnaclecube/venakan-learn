import { useCallback, useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Loader2, Sparkles, Check, Undo2, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  rollback,
  EXERCISE_TYPE_LABELS,
  GATE_TYPE_LABELS,
  type DiffPayload,
  type Exercise,
  type Module,
  type Program,
  type RoleDefinition,
} from "@/lib/generation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RefineDialog,
  type RefineTarget,
} from "@/components/program/RefineDialog";
import { DiffView } from "@/components/program/DiffView";

interface PendingDiff {
  refinementId: string;
  diff: DiffPayload;
  label: string;
}

export function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const programId = params.programId;
  const [, navigate] = useLocation();

  const [program, setProgram] = useState<Program | null>(null);
  const [role, setRole] = useState<RoleDefinition | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [rationale, setRationale] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const [refineTarget, setRefineTarget] = useState<RefineTarget | null>(null);
  const [pending, setPending] = useState<PendingDiff | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: prog, error: progErr } = await supabase
      .from("program")
      .select("*")
      .eq("id", programId)
      .maybeSingle();
    if (progErr || !prog) {
      setError(progErr?.message ?? "Program not found.");
      setLoading(false);
      return;
    }
    setProgram(prog as Program);

    const [roleRes, modRes, refRes] = await Promise.all([
      supabase
        .from("role_definition")
        .select("*")
        .eq("id", (prog as Program).role_definition_id)
        .maybeSingle(),
      supabase
        .from("module")
        .select("*")
        .eq("program_id", programId)
        .order("order", { ascending: true }),
      // Latest program-level refinement carries the most recent week_count rationale.
      supabase
        .from("refinement")
        .select("diff")
        .eq("program_id", programId)
        .eq("target_kind", "program")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);

    if (roleRes.data) setRole(roleRes.data as RoleDefinition);
    const mods = (modRes.data as Module[]) ?? [];
    setModules(mods);

    const latestProgRef = (refRes.data as Array<{ diff: DiffPayload }>) ?? [];
    const newRationale = (
      latestProgRef[0]?.diff?.new as { week_count_rationale?: string } | undefined
    )?.week_count_rationale;
    setRationale(newRationale ?? "");

    if (mods.length > 0) {
      const { data: exData } = await supabase
        .from("exercise")
        .select("*")
        .in(
          "module_id",
          mods.map((m) => m.id),
        );
      setExercises((exData as Exercise[]) ?? []);
    } else {
      setExercises([]);
    }
    setLoading(false);
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onPublish() {
    if (!program) return;
    setPublishing(true);
    setError(null);
    const { error: upErr } = await supabase
      .from("program")
      .update({ status: "published" })
      .eq("id", program.id);
    if (upErr) setError(upErr.message);
    else await load();
    setPublishing(false);
  }

  async function onRollback() {
    if (!pending) return;
    setRollingBack(true);
    setError(null);
    try {
      await rollback(pending.refinementId);
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rollback failed.");
    } finally {
      setRollingBack(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
      </div>
    );
  }

  if (!program) {
    return (
      <div>
        <PageHeader title="Program" />
        <p className="text-sm text-destructive">{error ?? "Not found."}</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={role?.title ?? "Program"}
        description={`${program.week_count} weeks · version ${program.version}`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/trainer/programs")}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Badge variant={program.status === "published" ? "success" : "muted"}>
              {program.status}
            </Badge>
            {program.status === "draft" && (
              <Button size="sm" onClick={onPublish} disabled={publishing}>
                {publishing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
                  </>
                ) : (
                  "Publish"
                )}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {pending && (
        <Card className="mb-4 border-emerald/40">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Refinement applied · {pending.label}
            </CardTitle>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPending(null)}
                disabled={rollingBack}
              >
                <Check className="h-4 w-4" /> Accept
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onRollback}
                disabled={rollingBack}
              >
                {rollingBack ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Undo2 className="h-4 w-4" />
                )}
                Rollback
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <DiffView diff={pending.diff} />
          </CardContent>
        </Card>
      )}

      {/* Program-level summary + refine */}
      <Card className="mb-4">
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Program overview</CardTitle>
            {rationale && (
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {rationale}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setRefineTarget({
                kind: "program",
                id: program.id,
                label: "Program (week count & rationale)",
              })
            }
          >
            <Sparkles className="h-4 w-4" /> Refine
          </Button>
        </CardHeader>
      </Card>

      {/* Module sequence */}
      <div className="space-y-4">
        {modules.map((m) => {
          const moduleExercises = exercises.filter(
            (ex) => ex.module_id === m.id,
          );
          return (
            <Card key={m.id}>
              <CardHeader className="flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">
                    {m.order}. {m.title}
                  </CardTitle>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline">{GATE_TYPE_LABELS[m.gate_type]}</Badge>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setRefineTarget({
                      kind: "module",
                      id: m.id,
                      label: m.title,
                    })
                  }
                >
                  <Sparkles className="h-4 w-4" /> Refine
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {m.objectives.length > 0 && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Objectives
                    </p>
                    <ul className="list-disc space-y-0.5 pl-5 text-sm">
                      {m.objectives.map((o, i) => (
                        <li key={i}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.materials && (
                  <div>
                    <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Materials
                    </p>
                    <p className="text-sm text-muted-foreground">{m.materials}</p>
                  </div>
                )}

                <div className="space-y-3">
                  {moduleExercises.map((ex) => (
                    <div
                      key={ex.id}
                      className="rounded-md border border-border p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge>{EXERCISE_TYPE_LABELS[ex.type]}</Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setRefineTarget({
                                kind: "exercise",
                                id: ex.id,
                                label: `Exercise (${EXERCISE_TYPE_LABELS[ex.type]})`,
                              })
                            }
                          >
                            <Sparkles className="h-4 w-4" /> Exercise
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setRefineTarget({
                                kind: "rubric",
                                id: ex.id,
                                label: `Rubric for ${EXERCISE_TYPE_LABELS[ex.type]} exercise`,
                              })
                            }
                          >
                            <Sparkles className="h-4 w-4" /> Rubric
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 text-sm">{ex.prompt}</p>
                      {ex.rubric?.criteria?.length > 0 && (
                        <div className="mt-3">
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Rubric
                          </p>
                          <ul className="space-y-0.5 text-sm">
                            {ex.rubric.criteria.map((c, i) => (
                              <li key={i} className="flex justify-between gap-3">
                                <span>
                                  {c.name}
                                  <span className="text-muted-foreground">
                                    {" "}
                                    — {c.description}
                                  </span>
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                  {Math.round((c.weight ?? 0) * 100)}%
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                  {moduleExercises.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No exercises.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <RefineDialog
        programId={program.id}
        target={refineTarget}
        onOpenChange={(open) => {
          if (!open) setRefineTarget(null);
        }}
        onRefined={(result) => {
          setPending({
            refinementId: result.refinementId,
            diff: result.diff,
            label: refineTarget?.label ?? "",
          });
          void load();
        }}
      />
    </div>
  );
}
