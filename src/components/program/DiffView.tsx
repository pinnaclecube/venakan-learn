import type { DiffPayload } from "@/lib/generation";

interface DiffViewProps {
  diff: DiffPayload;
}

/** Simple, readable old-vs-new view of a refinement diff (pretty JSON). */
export function DiffView({ diff }: DiffViewProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Panel label="Before" tone="muted" value={diff.old} />
      <Panel label="After" tone="emerald" value={diff.new} />
    </div>
  );
}

function Panel({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "muted" | "emerald";
  value: unknown;
}) {
  return (
    <div className="rounded-md border border-border bg-mist/50">
      <div
        className={
          "border-b border-border px-3 py-1.5 text-xs font-medium " +
          (tone === "emerald" ? "text-emerald-strong" : "text-muted-foreground")
        }
      >
        {label}
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2 text-xs leading-relaxed text-foreground">
        {safeStringify(value)}
      </pre>
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
