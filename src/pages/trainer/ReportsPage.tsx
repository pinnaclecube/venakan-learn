import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  type EnrollmentStatus,
  type GateStatus,
} from "@/lib/reporting";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/reports/ProgressBar";
import { BarChart, type BarDatum } from "@/components/reports/BarChart";
import { EnrollmentStatusBadge } from "@/components/reports/StatusBadge";
import {
  ReviewSubmissionDialog,
  type ReviewTarget,
} from "@/components/program/ReviewSubmissionDialog";

// --- Row shapes from the nested selects -------------------------------------
interface EnrollmentRow {
  id: string;
  candidate_id: string;
  program_id: string;
  current_module_order: number;
  status: EnrollmentStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  candidate: {
    track: string | null;
    profile: { full_name: string | null } | null;
  } | null;
  program: {
    id: string;
    week_count: number;
    role_definition: { title: string } | null;
  } | null;
}

interface ModuleRow {
  id: string;
  program_id: string;
  order: number;
  title: string;
  gate_type: string;
}

interface SubmissionRow {
  id: string;
  enrollment_id: string;
  module_id: string | null;
  exercise_id: string | null;
  gate_status: GateStatus;
  submitted_at: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export function ReportsPage() {
  const { role, profile } = useAuth();
  const [enrollments, setEnrollments] = useState<EnrollmentRow[]>([]);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [programFilter, setProgramFilter] = useState<string>("all");
  const [trackFilter, setTrackFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Trainers see only programs they are assigned to (the shared review queue
    // for each). Admins see all tenant data unchanged. "Any assigned trainer
    // sees the full shared queue" — there is NO per-trainee filtering.
    let assignedProgramIds: string[] | null = null;
    if (role === "trainer" && profile?.id) {
      const ptRes = await supabase
        .from("program_trainer")
        .select("program_id")
        .eq("trainer_profile_id", profile.id);
      if (ptRes.error) {
        setError(ptRes.error.message);
        setLoading(false);
        return;
      }
      assignedProgramIds = [
        ...new Set(
          (ptRes.data as { program_id: string }[]).map((r) => r.program_id),
        ),
      ];
    }

    let enrQuery = supabase
      .from("enrollment")
      .select(
        "id, candidate_id, program_id, current_module_order, status, started_at, completed_at, created_at, candidate(track, profile(full_name)), program(id, week_count, role_definition(title))",
      )
      .order("created_at", { ascending: false });
    if (assignedProgramIds !== null) {
      // No assignments => no rows. .in([]) yields an empty set as intended.
      enrQuery = enrQuery.in("program_id", assignedProgramIds);
    }

    const [enrRes, modRes, subRes] = await Promise.all([
      enrQuery,
      supabase
        .from("module")
        .select("id, program_id, \"order\", title, gate_type")
        .order("order", { ascending: true }),
      supabase
        .from("submission")
        .select("id, enrollment_id, module_id, exercise_id, gate_status, submitted_at")
        .order("submitted_at", { ascending: true }),
    ]);
    if (enrRes.error) setError(enrRes.error.message);
    else setEnrollments((enrRes.data as unknown as EnrollmentRow[]) ?? []);
    if (modRes.error) setError(modRes.error.message);
    else setModules((modRes.data as unknown as ModuleRow[]) ?? []);
    if (subRes.error) setError(subRes.error.message);
    else setSubmissions((subRes.data as unknown as SubmissionRow[]) ?? []);
    setLoading(false);
  }, [role, profile?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lookups ------------------------------------------------------------------
  const moduleCountByProgram = useMemo(() => {
    const m = new Map<string, number>();
    for (const mod of modules) m.set(mod.program_id, (m.get(mod.program_id) ?? 0) + 1);
    return m;
  }, [modules]);

  const moduleById = useMemo(() => {
    const m = new Map<string, ModuleRow>();
    for (const mod of modules) m.set(mod.id, mod);
    return m;
  }, [modules]);

  const lastSubmissionByEnrollment = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of submissions) {
      if (!s.submitted_at) continue;
      const prev = m.get(s.enrollment_id);
      if (!prev || s.submitted_at > prev) m.set(s.enrollment_id, s.submitted_at);
    }
    return m;
  }, [submissions]);

  // Filter option lists ------------------------------------------------------
  const programOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of enrollments) {
      if (e.program) {
        seen.set(
          e.program.id,
          e.program.role_definition?.title ?? "Program",
        );
      }
    }
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [enrollments]);

  const trackOptions = useMemo(() => {
    const s = new Set<string>();
    for (const e of enrollments) if (e.candidate?.track) s.add(e.candidate.track);
    return [...s];
  }, [enrollments]);

  // Filtered enrollments -----------------------------------------------------
  const filtered = useMemo(() => {
    return enrollments.filter((e) => {
      if (programFilter !== "all" && e.program_id !== programFilter) return false;
      if (trackFilter !== "all" && (e.candidate?.track ?? "") !== trackFilter)
        return false;
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      return true;
    });
  }, [enrollments, programFilter, trackFilter, statusFilter]);

  // Cohort rows --------------------------------------------------------------
  const cohortRows = useMemo(() => {
    const now = Date.now();
    return filtered.map((e) => {
      const moduleCount = moduleCountByProgram.get(e.program_id) ?? 0;
      const pct =
        moduleCount > 0
          ? Math.min(100, (e.current_module_order / moduleCount) * 100)
          : 0;
      const currentModule = modules.find(
        (m) => m.program_id === e.program_id && m.order === e.current_module_order,
      );
      const lastSub = lastSubmissionByEnrollment.get(e.id) ?? null;
      const lastActivity =
        lastSub ??
        e.completed_at ??
        e.started_at ??
        e.created_at ??
        null;

      // Stuck: awaiting_review > 3 days, OR no activity in 7 days.
      const lastMs = lastActivity ? new Date(lastActivity).getTime() : 0;
      const ageDays = lastMs ? (now - lastMs) / DAY : Infinity;
      const stuck =
        (e.status === "awaiting_review" && ageDays > 3) ||
        (e.status !== "completed" && e.status !== "not_started" && ageDays > 7);

      return {
        enrollmentId: e.id,
        name: e.candidate?.profile?.full_name ?? "Unnamed trainee",
        track: e.candidate?.track ?? null,
        programId: e.program_id,
        currentOrder: e.current_module_order,
        currentModuleTitle: currentModule?.title ?? null,
        moduleCount,
        status: e.status,
        percentComplete: pct,
        lastActivity,
        stuck,
      };
    });
  }, [filtered, modules, moduleCountByProgram, lastSubmissionByEnrollment]);

  // Per-module funnel for a selected program ---------------------------------
  // If a program is selected use it; else use the program with the most enrollments.
  const funnelProgramId = useMemo(() => {
    if (programFilter !== "all") return programFilter;
    const counts = new Map<string, number>();
    for (const e of filtered) counts.set(e.program_id, (counts.get(e.program_id) ?? 0) + 1);
    let best: string | null = null;
    let bestN = -1;
    for (const [id, n] of counts) if (n > bestN) ((best = id), (bestN = n));
    return best;
  }, [programFilter, filtered]);

  const funnelData: BarDatum[] = useMemo(() => {
    if (!funnelProgramId) return [];
    const mods = modules
      .filter((m) => m.program_id === funnelProgramId)
      .sort((a, b) => a.order - b.order);
    return mods.map((m) => ({
      label: `M${m.order}: ${m.title}`,
      value: filtered.filter(
        (e) => e.program_id === funnelProgramId && e.current_module_order === m.order,
      ).length,
    }));
  }, [funnelProgramId, modules, filtered]);

  // Gate queue: pending submissions whose module is trainer_review ----------
  const gateQueue = useMemo(() => {
    const enrollmentById = new Map(filtered.map((e) => [e.id, e]));
    return submissions
      .filter((s) => s.gate_status === "pending")
      .filter((s) => {
        const mod = s.module_id ? moduleById.get(s.module_id) : undefined;
        return mod?.gate_type === "trainer_review";
      })
      .filter((s) => enrollmentById.has(s.enrollment_id))
      .map((s) => {
        const e = enrollmentById.get(s.enrollment_id)!;
        const mod = s.module_id ? moduleById.get(s.module_id) : undefined;
        return {
          id: s.id,
          name: e.candidate?.profile?.full_name ?? "Unnamed trainee",
          moduleTitle: mod ? `M${mod.order}: ${mod.title}` : "—",
          programId: e.program_id,
          submittedAt: s.submitted_at,
        };
      })
      .sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  }, [submissions, filtered, moduleById]);

  // Pass-rate per module -----------------------------------------------------
  const passRateData: BarDatum[] = useMemo(() => {
    const enrollmentIds = new Set(filtered.map((e) => e.id));
    const byModule = new Map<string, { passed: number; failed: number }>();
    for (const s of submissions) {
      if (!enrollmentIds.has(s.enrollment_id)) continue;
      if (!s.module_id) continue;
      if (s.gate_status === "pending") continue;
      const entry = byModule.get(s.module_id) ?? { passed: 0, failed: 0 };
      if (s.gate_status === "passed") entry.passed += 1;
      else entry.failed += 1;
      byModule.set(s.module_id, entry);
    }
    const rows: BarDatum[] = [];
    for (const [moduleId, { passed, failed }] of byModule) {
      const mod = moduleById.get(moduleId);
      const total = passed + failed;
      const rate = total > 0 ? Math.round((passed / total) * 100) : 0;
      rows.push({
        label: mod ? `M${mod.order}: ${mod.title}` : "Module",
        value: rate,
        hint: `${passed}/${total}`,
        highlight: rate >= 80,
      });
    }
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  }, [submissions, filtered, moduleById]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Reports" />
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Cohort progress, gate queue, and pass-rate signals across your programs."
      />

      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="w-56">
          <Select value={programFilter} onValueChange={setProgramFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All programs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All programs</SelectItem>
              {programOptions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40">
          <Select value={trackFilter} onValueChange={setTrackFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All tracks" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tracks</SelectItem>
              {trackOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="not_started">Not started</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="awaiting_review">Awaiting review</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Cohort table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Cohort</CardTitle>
        </CardHeader>
        <CardContent>
          {cohortRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No enrollments match these filters yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trainee</TableHead>
                  <TableHead>Track</TableHead>
                  <TableHead>Current module</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-44">Progress</TableHead>
                  <TableHead>Last activity</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohortRows.map((r) => (
                  <TableRow key={r.enrollmentId}>
                    <TableCell className="font-medium text-ink">{r.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.track ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.moduleCount > 0
                        ? `M${r.currentOrder}${r.currentModuleTitle ? ` · ${r.currentModuleTitle}` : ""}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <EnrollmentStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <ProgressBar value={r.percentComplete} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(r.lastActivity)}
                    </TableCell>
                    <TableCell>
                      {r.stuck && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                          <AlertTriangle className="h-3.5 w-3.5" /> Stuck
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Per-module funnel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Module funnel</CardTitle>
            <p className="text-sm text-muted-foreground">
              Where trainees currently sit in the program.
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={funnelData}
              emptyMessage="No enrollments to chart yet."
            />
          </CardContent>
        </Card>

        {/* Pass-rate panel */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pass rate by module</CardTitle>
            <p className="text-sm text-muted-foreground">
              Graded gates — low rates flag too-hard modules.
            </p>
          </CardHeader>
          <CardContent>
            <BarChart
              data={passRateData}
              emptyMessage="No graded submissions yet."
            />
          </CardContent>
        </Card>
      </div>

      {/* Gate queue */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Gate queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            Pending trainer-review submissions, oldest first.
          </p>
        </CardHeader>
        <CardContent>
          {gateQueue.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Nothing waiting for review.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trainee</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateQueue.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium text-ink">{g.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {g.moduleTitle}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {fmtDate(g.submittedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setReviewTarget({
                            submissionId: g.id,
                            traineeName: g.name,
                            moduleTitle: g.moduleTitle,
                          })
                        }
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {enrollments.length === 0 && !error && (
        <Card className="mt-6">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No trainees are enrolled yet. Enrollment and submission data appear
            here once the delivery runtime is live.{" "}
            <Badge variant="muted">Empty</Badge>
          </CardContent>
        </Card>
      )}

      <ReviewSubmissionDialog
        target={reviewTarget}
        onOpenChange={(open) => {
          if (!open) setReviewTarget(null);
        }}
        onReviewed={() => {
          setReviewTarget(null);
          void load();
        }}
      />
    </div>
  );
}
