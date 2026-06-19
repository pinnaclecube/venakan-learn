import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  loadAssignableStaff,
  loadAssignableTrainees,
  loadProgramAssignment,
  publishAndAssign,
  type AssignableProfile,
} from "@/lib/assignment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AssignmentDialogProps {
  programId: string;
  programFamily?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

/** A single scrollable, filterable checkbox list of profiles. */
function CheckboxList({
  people,
  selected,
  onToggle,
  filter,
  emptyMessage,
}: {
  people: AssignableProfile[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  filter: string;
  emptyMessage: string;
}) {
  const q = filter.trim().toLowerCase();
  const visible = q
    ? people.filter(
        (p) =>
          (p.full_name ?? "").toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q),
      )
    : people;

  if (people.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-border">
      {visible.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No matches.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((p) => (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-mist">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-emerald-strong"
                  checked={selected.has(p.id)}
                  onChange={() => onToggle(p.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {p.full_name ?? p.email}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.email}
                    {p.track ? ` · ${p.track}` : ""}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AssignmentDialog({
  programId,
  programFamily,
  open,
  onOpenChange,
  onDone,
}: AssignmentDialogProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [staff, setStaff] = useState<AssignableProfile[]>([]);
  const [trainees, setTrainees] = useState<AssignableProfile[]>([]);
  const [alreadyAssignedTrainers, setAlreadyAssignedTrainers] = useState<
    Set<string>
  >(new Set());
  const [enrolledProfileIds, setEnrolledProfileIds] = useState<Set<string>>(
    new Set(),
  );

  const [selectedTrainers, setSelectedTrainers] = useState<Set<string>>(
    new Set(),
  );
  const [selectedTrainees, setSelectedTrainees] = useState<Set<string>>(
    new Set(),
  );

  const [trainerFilter, setTrainerFilter] = useState("");
  const [traineeFilter, setTraineeFilter] = useState("");
  const [matchTrack, setMatchTrack] = useState(false);
  const [confirmRemovals, setConfirmRemovals] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSubmitError(null);
    setConfirmRemovals(false);
    try {
      const [staffList, traineeList, assignment] = await Promise.all([
        loadAssignableStaff(),
        loadAssignableTrainees(),
        loadProgramAssignment(programId),
      ]);
      setStaff(staffList);
      setTrainees(traineeList);

      const assignedTrainerIds = new Set(assignment.trainers.map((t) => t.id));
      const enrolledIds = new Set(assignment.enrolledProfileIds);
      setAlreadyAssignedTrainers(assignedTrainerIds);
      setEnrolledProfileIds(enrolledIds);
      // Pre-check current state.
      setSelectedTrainers(new Set(assignedTrainerIds));
      setSelectedTrainees(new Set(enrolledIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assignment.");
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  const toggle = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Trainee list, optionally filtered to this program's track.
  const visibleTrainees = useMemo(() => {
    if (!matchTrack || !programFamily) return trainees;
    return trainees.filter((t) => t.track && t.track === programFamily);
  }, [trainees, matchTrack, programFamily]);

  // Removals: currently-enrolled trainees that are now unchecked.
  const removalProfileIds = useMemo(
    () => [...enrolledProfileIds].filter((id) => !selectedTrainees.has(id)),
    [enrolledProfileIds, selectedTrainees],
  );

  const removalNames = useMemo(() => {
    const byId = new Map(trainees.map((t) => [t.id, t.full_name ?? t.id]));
    return removalProfileIds.map((id) => byId.get(id) ?? id);
  }, [removalProfileIds, trainees]);

  const trainersWouldBeAssigned = selectedTrainers.size;
  const noTrainer = trainersWouldBeAssigned === 0;
  const removalsBlocked = removalProfileIds.length > 0 && !confirmRemovals;

  async function onSubmit() {
    if (noTrainer) return;
    if (removalsBlocked) {
      setSubmitError("Confirm the unenrollment warning to continue.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await publishAndAssign(
        programId,
        [...selectedTrainers],
        [...selectedTrainees],
        confirmRemovals ? removalProfileIds : [],
      );
      onOpenChange(false);
      onDone();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Publish & assign failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Publish & assign</DialogTitle>
          <DialogDescription>
            Assign reviewers and enroll trainees. The program goes live only when
            you confirm — any assigned trainer can review any trainee.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-strong" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <div className="space-y-6">
            {/* Trainers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">
                  Trainers{" "}
                  <span className="text-muted-foreground">
                    ({trainersWouldBeAssigned} selected)
                  </span>
                </p>
              </div>
              <Input
                placeholder="Search trainers…"
                value={trainerFilter}
                onChange={(e) => setTrainerFilter(e.target.value)}
              />
              <CheckboxList
                people={staff}
                selected={selectedTrainers}
                onToggle={(id) => toggle(setSelectedTrainers, id)}
                filter={trainerFilter}
                emptyMessage="No active trainers or admins to assign."
              />
              {noTrainer && (
                <p className="text-xs text-destructive">
                  At least one trainer must be assigned.
                </p>
              )}
            </div>

            {/* Trainees */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">
                  Trainees{" "}
                  <span className="text-muted-foreground">
                    ({selectedTrainees.size} selected)
                  </span>
                </p>
                {programFamily && (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-emerald-strong"
                      checked={matchTrack}
                      onChange={(e) => setMatchTrack(e.target.checked)}
                    />
                    Match track ({programFamily})
                  </label>
                )}
              </div>
              <Input
                placeholder="Search trainees…"
                value={traineeFilter}
                onChange={(e) => setTraineeFilter(e.target.value)}
              />
              <CheckboxList
                people={visibleTrainees}
                selected={selectedTrainees}
                onToggle={(id) => toggle(setSelectedTrainees, id)}
                filter={traineeFilter}
                emptyMessage="No active trainees to enroll."
              />
            </div>

            {/* Removal safety */}
            {removalProfileIds.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-destructive">
                      Unenrolling {removalProfileIds.length} trainee
                      {removalProfileIds.length === 1 ? "" : "s"} will permanently
                      delete their submissions for this program.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {removalNames.join(", ")}
                    </p>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-emerald-strong"
                        checked={confirmRemovals}
                        onChange={(e) => setConfirmRemovals(e.target.checked)}
                      />
                      I understand — unenroll and delete their submissions.
                    </label>
                  </div>
                </div>
              </div>
            )}

            {alreadyAssignedTrainers.size > 0 && (
              <p className="text-xs text-muted-foreground">
                <Badge variant="muted">Re-publish</Badge> Existing trainers and
                enrollments are kept; this is idempotent.
              </p>
            )}

            {submitError && (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={loading || submitting || noTrainer || removalsBlocked}
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Publishing…
              </>
            ) : (
              "Publish & Assign"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
