import { Terminal } from "lucide-react";
import type { RunExerciseResult } from "@/lib/runtime";

interface RunConsoleProps {
  result: RunExerciseResult | null;
  error: string | null;
}

/**
 * Output panel for a playground "Run". Shows captured stdout/stderr, the exit
 * code, and how long the sandbox run took. This is a dry run — not a graded
 * submission.
 */
export function RunConsole({ result, error }: RunConsoleProps) {
  if (!error && !result) return null;

  const passed = result?.exitCode === 0;

  return (
    <div className="space-y-2 rounded-md border border-border bg-ink/95 p-3 text-xs text-mist">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-semibold text-white">
          <Terminal className="h-3.5 w-3.5" /> Run output
        </span>
        {result?.ran && (
          <span className="flex items-center gap-2 text-[11px]">
            <span className={passed ? "text-emerald-300" : "text-red-300"}>
              exit {result.exitCode}
            </span>
            <span className="text-mist/50">
              {(result.durationMs / 1000).toFixed(1)}s
            </span>
          </span>
        )}
      </div>

      {error && <p className="font-medium text-red-300">{error}</p>}

      {result && !result.ran && (
        <p className="text-mist/80">{result.note}</p>
      )}

      {result?.ran && (
        <div className="space-y-2">
          {result.stdout?.trim() ? (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-mist">
              {result.stdout}
            </pre>
          ) : (
            <p className="text-mist/50">(no stdout)</p>
          )}
          {result.stderr?.trim() && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-red-300">
              {result.stderr}
            </pre>
          )}
          <p className="text-[10px] text-mist/50">
            This was a practice run — it is not recorded. Use Submit when you’re
            ready to be graded.
          </p>
        </div>
      )}
    </div>
  );
}
