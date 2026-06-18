import { Badge } from "@/components/ui/badge";
import {
  ENROLLMENT_STATUS_LABELS,
  GATE_STATUS_LABELS,
  type EnrollmentStatus,
  type GateStatus,
} from "@/lib/reporting";

type BadgeVariant = "success" | "warning" | "muted" | "destructive" | "default";

const ENROLLMENT_VARIANT: Record<EnrollmentStatus, BadgeVariant> = {
  not_started: "muted",
  in_progress: "default",
  awaiting_review: "warning",
  completed: "success",
};

const GATE_VARIANT: Record<GateStatus, BadgeVariant> = {
  pending: "warning",
  passed: "success",
  failed: "destructive",
};

export function EnrollmentStatusBadge({ status }: { status: EnrollmentStatus }) {
  return (
    <Badge variant={ENROLLMENT_VARIANT[status]}>
      {ENROLLMENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function GateStatusBadge({ status }: { status: GateStatus }) {
  return (
    <Badge variant={GATE_VARIANT[status]}>{GATE_STATUS_LABELS[status]}</Badge>
  );
}
