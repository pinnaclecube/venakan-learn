// Playground "Run" (Option B). SERVER-ONLY. A dry run of the candidate's
// current draft inside the SAME isolated sandbox model used for grading — but
// it records NOTHING and applies NO gate. Candidate code is UNTRUSTED and only
// ever executes inside the sandbox (empty env, timeout/vCPU caps, guaranteed
// teardown). See api/grading/sandbox.ts for the isolation guarantees.

import { getGradingSandbox, type SandboxHandle } from "./sandbox.js";
import type { SandboxConfig } from "./types.js";

const SANDBOX_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 60_000;
const MAX_OUT = 8000;

export interface PreviewRunResult {
  /** false when the exercise has no runnable command configured. */
  ran: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  note?: string;
}

function clip(s: string, max = MAX_OUT): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
}

/**
 * Pick the command Run executes: an explicit run_command, else the grading
 * eval_command/test_command (so Run works on existing exercises with no
 * re-authoring). Returns null when none is configured.
 */
function pickRunCommand(
  cfg: SandboxConfig,
): { cmd: string; args: string[] } | null {
  const command = cfg.run_command ?? cfg.eval_command ?? cfg.test_command;
  if (!Array.isArray(command) || command.length === 0) return null;
  return { cmd: command[0], args: command.slice(1) };
}

/**
 * Write the candidate draft + any config fixtures into a fresh sandbox, run the
 * chosen command once, and ALWAYS destroy the sandbox in a finally.
 */
export async function previewRun(
  cfg: SandboxConfig,
  artifact: string,
): Promise<PreviewRunResult> {
  const chosen = pickRunCommand(cfg);
  if (!chosen) {
    return {
      ran: false,
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      note: "This exercise has no runnable configuration yet — write your solution and Submit for grading.",
    };
  }

  const runtime = cfg.runtime === "python" ? "python" : "node";
  const artifactPath = cfg.artifact_path ?? "solution.txt";
  const files = [
    { path: artifactPath, content: artifact ?? "" },
    ...(cfg.files ?? []),
  ];
  // RAG exercises grade against a baseline corpus; include it so Run matches.
  if (cfg.baseline !== undefined) {
    files.push({ path: "baseline.json", content: JSON.stringify(cfg.baseline) });
  }

  const sandbox = getGradingSandbox();
  const started = Date.now();
  let handle: SandboxHandle | null = null;
  try {
    handle = await sandbox.create({ runtime, timeoutMs: SANDBOX_TIMEOUT_MS });
    if (files.length > 0) await sandbox.writeFiles(handle, files);
    const res = await sandbox.run(
      handle,
      chosen.cmd,
      chosen.args,
      RUN_TIMEOUT_MS,
    );
    return {
      ran: true,
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exitCode: res.exitCode,
      durationMs: Date.now() - started,
    };
  } finally {
    if (handle) {
      try {
        await sandbox.destroy(handle);
      } catch {
        /* best-effort teardown */
      }
    }
  }
}
