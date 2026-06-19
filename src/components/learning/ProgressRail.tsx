import { Check, Circle, Lock } from "lucide-react";
import type { TraineeModule } from "@/lib/runtime";

interface ProgressRailProps {
  modules: TraineeModule[];
  currentOrder: number;
  selectedOrder: number;
  onSelect: (order: number) => void;
}

/** Left rail: ordered modules with done / current / locked states. */
export function ProgressRail({
  modules,
  currentOrder,
  selectedOrder,
  onSelect,
}: ProgressRailProps) {
  return (
    <nav aria-label="Modules" className="space-y-1">
      {modules.map((m) => {
        const done = m.order < currentOrder;
        const isCurrent = m.order === currentOrder;
        const locked = m.order > currentOrder;
        const selected = m.order === selectedOrder;

        const base =
          "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors";
        const state = selected
          ? "border-emerald bg-emerald/10"
          : locked
            ? "border-border opacity-60"
            : "border-border hover:bg-mist";

        return (
          <button
            key={m.id}
            type="button"
            disabled={locked}
            aria-current={selected ? "true" : undefined}
            onClick={() => !locked && onSelect(m.order)}
            className={
              base + " " + state + (locked ? " cursor-not-allowed" : "")
            }
          >
            <span className="mt-0.5 shrink-0">
              {done ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-strong text-white">
                  <Check className="h-2.5 w-2.5" />
                </span>
              ) : isCurrent ? (
                <Circle className="h-4 w-4 text-emerald-strong" />
              ) : (
                <Lock className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
            <span
              className={
                "min-w-0 flex-1 " +
                (locked ? "text-muted-foreground" : "text-ink")
              }
            >
              <span className="block text-xs font-medium text-muted-foreground">
                Module {m.order}
              </span>
              <span className="block truncate font-medium">{m.title}</span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
