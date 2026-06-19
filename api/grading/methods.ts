// Grading methods (Prompt 6). SERVER-ONLY. One function per exercise type, each
// taking (context, sandbox) and returning an AiGrade. Candidate `artifact` is
// UNTRUSTED — it only ever runs inside the isolated sandbox, never on the host.
//
// Guarantees:
//   * If a config is insufficient to grade in the sandbox, the method returns
//     status:"needs_manual_review" with a clear note (it does NOT pass/fail,
//     and does NOT crash).
//   * The dispatcher wraps everything in try/catch -> status:"error" on throw,
//     and ALWAYS destroys the sandbox in a finally.

import { createHash } from "node:crypto";
import {
  getAnthropicClient,
  ANTHROPIC_MODEL,
  parseJsonFromMessage,
  textFromContent,
} from "../_anthropic.js";
import { getAdminClient } from "../_supabaseAdmin.js";
import type {
  AiGrade,
  AiGradeDimension,
  GradingMethod,
  Rubric,
  SandboxConfig,
  SubmissionContext,
} from "./types.js";
import {
  getGradingSandbox,
  type GradingSandbox,
  type SandboxHandle,
} from "./sandbox.js";

const SANDBOX_TIMEOUT_MS = 90_000;
const RUN_TIMEOUT_MS = 60_000;

function nowIso(): string {
  return new Date().toISOString();
}

function manualReview(method: GradingMethod, note: string): AiGrade {
  return { status: "needs_manual_review", method, note, graded_at: nowIso() };
}

function runtimeOf(cfg: SandboxConfig): "node" | "python" {
  return cfg.runtime === "python" ? "python" : "node";
}

/** sha256 of canonical rubric JSON — auditable/calibratable judge version. */
function rubricVersion(rubric: Rubric): string {
  const json = JSON.stringify(rubric ?? {});
  return createHash("sha256").update(json).digest("hex");
}

/** Split a configured command array into (cmd, args). */
function splitCommand(command?: string[]): { cmd: string; args: string[] } | null {
  if (!Array.isArray(command) || command.length === 0) return null;
  return { cmd: command[0], args: command.slice(1) };
}

/**
 * Create a sandbox, write files, run ONE command, and ALWAYS destroy the
 * sandbox in a finally. Centralizes the untrusted-code lifecycle so no method
 * can leak a running VM. Returns the command result.
 */
async function withSandboxRun(
  sandbox: GradingSandbox,
  runtime: "node" | "python",
  files: { path: string; content: string }[],
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let handle: SandboxHandle | null = null;
  try {
    handle = await sandbox.create({ runtime, timeoutMs: SANDBOX_TIMEOUT_MS });
    if (files.length > 0) await sandbox.writeFiles(handle, files);
    return await sandbox.run(handle, cmd, args, RUN_TIMEOUT_MS);
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

// ---------------------------------------------------------------------------
// gradeCode — write candidate + test files, run the test command, parse result.
// ---------------------------------------------------------------------------
export async function gradeCode(
  ctx: SubmissionContext,
  sandbox: GradingSandbox,
): Promise<AiGrade> {
  const cfg = ctx.exercise.sandbox_config ?? {};
  const cmd = splitCommand(cfg.test_command);

  // Deployable-app milestone: reachability check against a deployed target.
  if (!cmd && cfg.target_url) {
    return gradeReachability(ctx, sandbox, cfg.target_url, "code");
  }

  if (!cmd) {
    return manualReview(
      "code",
      "No test_command in sandbox_config; cannot auto-grade. Sent for manual review.",
    );
  }

  const artifactPath = cfg.artifact_path ?? "solution.txt";
  const files = [
    { path: artifactPath, content: ctx.artifact ?? "" },
    ...(cfg.files ?? []),
  ];

  const res = await withSandboxRun(
    sandbox,
    runtimeOf(cfg),
    files,
    cmd.cmd,
    cmd.args,
  );

  const passed = res.exitCode === 0;
  const dimensions = dimensionsFromRubric(ctx.exercise.rubric, passed);

  return {
    status: "graded",
    method: "code",
    passed,
    score: passed ? 100 : 0,
    max_score: 100,
    dimensions,
    output: {
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exit_code: res.exitCode,
      test_results: { exit_code: res.exitCode, passed },
    },
    note: passed ? "All tests passed." : "Test command exited non-zero.",
    graded_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// gradeRag — run the candidate pipeline against a baseline; compute metrics.
// ---------------------------------------------------------------------------
export async function gradeRag(
  ctx: SubmissionContext,
  sandbox: GradingSandbox,
): Promise<AiGrade> {
  const cfg = ctx.exercise.sandbox_config ?? {};
  const cmd = splitCommand(cfg.eval_command ?? cfg.test_command);
  if (!cmd) {
    return manualReview(
      "rag",
      "No eval_command in sandbox_config; cannot compute RAG metrics. Sent for manual review.",
    );
  }

  const artifactPath = cfg.artifact_path ?? "pipeline.txt";
  const files = [
    { path: artifactPath, content: ctx.artifact ?? "" },
    ...(cfg.files ?? []),
  ];
  if (cfg.baseline !== undefined) {
    files.push({ path: "baseline.json", content: JSON.stringify(cfg.baseline) });
  }

  const res = await withSandboxRun(
    sandbox,
    runtimeOf(cfg),
    files,
    cmd.cmd,
    cmd.args,
  );

  // The eval command is expected to emit a JSON metrics object on stdout, e.g.
  // { precision, recall, hit_rate }. Parse defensively; if we cannot, route to
  // manual review rather than guessing pass/fail.
  let metrics: Record<string, unknown> | null = null;
  try {
    metrics = parseJsonFromMessage<Record<string, unknown>>(res.stdout);
  } catch {
    metrics = null;
  }

  if (!metrics) {
    return {
      status: "needs_manual_review",
      method: "rag",
      output: {
        stdout: clip(res.stdout),
        stderr: clip(res.stderr),
        exit_code: res.exitCode,
      },
      note: "RAG eval produced no parseable metrics. Sent for manual review.",
      graded_at: nowIso(),
    };
  }

  const hitRate = numberOf(metrics, "hit_rate");
  const precision = numberOf(metrics, "precision");
  const recall = numberOf(metrics, "recall");
  // Score = hit_rate when present, else F1-ish blend of precision/recall.
  const score =
    hitRate !== null
      ? Math.round(hitRate * 100)
      : precision !== null && recall !== null && precision + recall > 0
        ? Math.round(((2 * precision * recall) / (precision + recall)) * 100)
        : null;

  if (score === null) {
    return {
      status: "needs_manual_review",
      method: "rag",
      output: { metrics, stdout: clip(res.stdout), stderr: clip(res.stderr) },
      note: "RAG metrics missing precision/recall/hit_rate. Sent for manual review.",
      graded_at: nowIso(),
    };
  }

  const passed = score >= 70 && res.exitCode === 0;
  return {
    status: "graded",
    method: "rag",
    passed,
    score,
    max_score: 100,
    output: {
      metrics,
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exit_code: res.exitCode,
    },
    note: `Retrieval quality score ${score}/100.`,
    graded_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// gradeAgent — run the agent against a task harness; capture tool traces.
// ---------------------------------------------------------------------------
export async function gradeAgent(
  ctx: SubmissionContext,
  sandbox: GradingSandbox,
): Promise<AiGrade> {
  const cfg = ctx.exercise.sandbox_config ?? {};
  const cmd = splitCommand(cfg.eval_command ?? cfg.test_command);
  if (!cmd) {
    return manualReview(
      "agent",
      "No eval_command/test_command (task harness) in sandbox_config. Sent for manual review.",
    );
  }

  const artifactPath = cfg.artifact_path ?? "agent.txt";
  const files = [
    { path: artifactPath, content: ctx.artifact ?? "" },
    ...(cfg.files ?? []),
  ];

  const res = await withSandboxRun(
    sandbox,
    runtimeOf(cfg),
    files,
    cmd.cmd,
    cmd.args,
  );

  // The harness is expected to emit a JSON report describing task completion
  // and the captured tool/function-call traces.
  let report: Record<string, unknown> | null = null;
  try {
    report = parseJsonFromMessage<Record<string, unknown>>(res.stdout);
  } catch {
    report = null;
  }

  if (!report) {
    // Fall back to exit code only — but if even that is ambiguous, manual.
    if (res.exitCode === 0) {
      return {
        status: "needs_manual_review",
        method: "agent",
        output: {
          stdout: clip(res.stdout),
          stderr: clip(res.stderr),
          exit_code: res.exitCode,
        },
        note: "Agent harness emitted no JSON report. Sent for manual review.",
        graded_at: nowIso(),
      };
    }
    return {
      status: "needs_manual_review",
      method: "agent",
      output: { stdout: clip(res.stdout), stderr: clip(res.stderr), exit_code: res.exitCode },
      note: "Agent harness failed without a structured report. Sent for manual review.",
      graded_at: nowIso(),
    };
  }

  const completed = boolOf(report, "completed");
  const safeFailure = boolOf(report, "safe_failure");
  const traces = report["traces"] ?? null;
  const score =
    numberOf(report, "score") ??
    (completed === true ? 100 : completed === false ? 0 : null);

  if (completed === null && score === null) {
    return {
      status: "needs_manual_review",
      method: "agent",
      output: { traces, stdout: clip(res.stdout), stderr: clip(res.stderr) },
      note: "Agent report did not indicate task completion. Sent for manual review.",
      graded_at: nowIso(),
    };
  }

  const passed = (completed === true || (score ?? 0) >= 70) && safeFailure !== false;
  return {
    status: "graded",
    method: "agent",
    passed,
    score: score ?? (passed ? 100 : 0),
    max_score: 100,
    output: {
      traces,
      metrics: { completed, safe_failure: safeFailure },
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exit_code: res.exitCode,
    },
    note: passed ? "Task completed with safe failure behavior." : "Task not completed.",
    graded_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// gradeJudge — NO sandbox. A server-side Claude call scores artifact vs rubric.
// ---------------------------------------------------------------------------

const JUDGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["overall_score", "passed", "summary", "dimensions"],
  properties: {
    overall_score: { type: "integer" },
    passed: { type: "boolean" },
    summary: { type: "string" },
    dimensions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "score", "max", "comment"],
        properties: {
          name: { type: "string" },
          score: { type: "integer" },
          max: { type: "integer" },
          comment: { type: "string" },
        },
      },
    },
  },
} as const;

interface JudgeOut {
  overall_score: number;
  passed: boolean;
  summary: string;
  dimensions: AiGradeDimension[];
}

export async function gradeJudge(ctx: SubmissionContext): Promise<AiGrade> {
  const rubric = ctx.exercise.rubric ?? {};
  const version = rubricVersion(rubric);

  if (!ctx.artifact || !ctx.artifact.trim()) {
    return {
      status: "needs_manual_review",
      method: "judge",
      judge_rubric_version: version,
      note: "Empty submission; nothing to judge. Sent for manual review.",
      graded_at: nowIso(),
    };
  }

  const anthropic = getAnthropicClient();
  const system =
    "You are a strict, fair grading judge for an AI-engineering training program. " +
    "Score the trainee's submission against the rubric. For each rubric criterion " +
    "produce a dimension score out of a sensible max, an overall_score in 0-100, " +
    "and a boolean passed (true only if the work meets the bar). Be concise and specific.";

  const userContent =
    `EXERCISE PROMPT:\n${ctx.exercise.prompt}\n\n` +
    `RUBRIC (snapshot ${version}):\n${JSON.stringify(rubric, null, 2)}\n\n` +
    `TRAINEE SUBMISSION:\n${ctx.artifact}`;

  const stream = anthropic.messages.stream({
    model: ANTHROPIC_MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system,
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    messages: [{ role: "user", content: userContent }],
  } as never);

  const msg = await stream.finalMessage();
  const raw = textFromContent(
    (msg as { content: Array<{ type: string; text?: string }> }).content,
  );
  const parsed = parseJsonFromMessage<JudgeOut>(raw);

  const score = Math.max(0, Math.min(100, Math.round(parsed.overall_score)));
  return {
    status: "graded",
    method: "judge",
    passed: Boolean(parsed.passed),
    score,
    max_score: 100,
    dimensions: Array.isArray(parsed.dimensions) ? parsed.dimensions : [],
    judge_rubric_version: version,
    note: parsed.summary,
    graded_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// gradeCrossTrack — Quality eval suite runs in the sandbox against an App
// Developer's deployed app. ALWAYS advisory; this gate always routes to a
// trainer (apply_grading_result never auto-advances cross_track).
// ---------------------------------------------------------------------------
export async function gradeCrossTrack(
  ctx: SubmissionContext,
  sandbox: GradingSandbox,
): Promise<AiGrade> {
  const cfg = ctx.exercise.sandbox_config ?? {};

  // Resolve the target deployed app URL: explicit, or from a referenced
  // submission's artifact (its artifact holds the deployed URL).
  let targetUrl = cfg.target_url ?? null;
  if (!targetUrl && cfg.target_submission_id) {
    targetUrl = await resolveTargetUrl(cfg.target_submission_id);
  }

  const cmd = splitCommand(cfg.eval_command);
  const evalFiles = cfg.eval_files ?? [];

  if (!cmd || evalFiles.length === 0) {
    // Without an eval suite we can still attempt a reachability advisory.
    if (targetUrl) {
      const adv = await gradeReachability(ctx, sandbox, targetUrl, "cross_track");
      return {
        ...adv,
        note:
          (adv.note ?? "") +
          " (advisory — cross-track gate always routes to a trainer)",
      };
    }
    return manualReview(
      "cross_track",
      "No eval suite or target URL in sandbox_config. Advisory only — routed to a trainer.",
    );
  }

  const files = [
    { path: cfg.artifact_path ?? "submission.txt", content: ctx.artifact ?? "" },
    ...evalFiles,
    ...(cfg.files ?? []),
  ];
  if (targetUrl) {
    files.push({ path: "target_url.txt", content: targetUrl });
  }

  const res = await withSandboxRun(
    sandbox,
    runtimeOf(cfg),
    files,
    cmd.cmd,
    cmd.args,
  );

  let metrics: Record<string, unknown> | null = null;
  try {
    metrics = parseJsonFromMessage<Record<string, unknown>>(res.stdout);
  } catch {
    metrics = null;
  }

  const passed = res.exitCode === 0;
  return {
    status: "graded",
    method: "cross_track",
    passed,
    score: passed ? 100 : 0,
    max_score: 100,
    output: {
      metrics: metrics ?? undefined,
      test_results: { exit_code: res.exitCode, target_url: targetUrl },
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exit_code: res.exitCode,
    },
    note: "Cross-track quality eval (advisory — a trainer makes the final call).",
    graded_at: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------
export async function gradeSubmission(
  ctx: SubmissionContext,
): Promise<AiGrade> {
  const method: GradingMethod =
    ctx.gate_type === "cross_track" ? "cross_track" : ctx.exercise.type;

  // Judge needs no sandbox.
  if (method === "judge") {
    try {
      return await gradeJudge(ctx);
    } catch (err) {
      return errorGrade(method, err);
    }
  }

  // Each sandbox-backed method runs via withSandboxRun, which ALWAYS destroys
  // the sandbox in a finally — so untrusted VMs are never leaked.
  const sandbox = getGradingSandbox();

  try {
    switch (method) {
      case "cross_track":
        return await gradeCrossTrack(ctx, sandbox);
      case "rag":
        return await gradeRag(ctx, sandbox);
      case "agent":
        return await gradeAgent(ctx, sandbox);
      case "code":
      default:
        return await gradeCode(ctx, sandbox);
    }
  } catch (err) {
    return errorGrade(method, err);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Reachability/behavior probe: run a curl inside the sandbox against the
 * deployed target. (Network egress is the sandbox's default; no secrets pass.)
 */
async function gradeReachability(
  ctx: SubmissionContext,
  sandbox: GradingSandbox,
  targetUrl: string,
  method: GradingMethod,
): Promise<AiGrade> {
  const res = await withSandboxRun(
    sandbox,
    runtimeOf(ctx.exercise.sandbox_config ?? {}),
    [],
    "curl",
    ["-fsS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "20", targetUrl],
  );
  const httpCode = parseInt(res.stdout.trim(), 10);
  const reachable = res.exitCode === 0 && httpCode >= 200 && httpCode < 400;
  return {
    status: "graded",
    method,
    passed: reachable,
    score: reachable ? 100 : 0,
    max_score: 100,
    output: {
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
      exit_code: res.exitCode,
      metrics: { target_url: targetUrl, http_code: httpCode },
    },
    note: reachable
      ? `Deployed app reachable (HTTP ${httpCode}).`
      : "Deployed app not reachable.",
    graded_at: nowIso(),
  };
}

/** Look up another submission's artifact (its deployed app URL). */
async function resolveTargetUrl(submissionId: string): Promise<string | null> {
  try {
    const admin = getAdminClient();
    const { data } = await admin
      .from("submission")
      .select("artifact")
      .eq("id", submissionId)
      .maybeSingle();
    const artifact = (data?.artifact as string | null) ?? null;
    if (!artifact) return null;
    const match = artifact.match(/https?:\/\/\S+/);
    return match ? match[0] : artifact.trim();
  } catch {
    return null;
  }
}

function dimensionsFromRubric(
  rubric: Rubric,
  passed: boolean,
): AiGradeDimension[] {
  const criteria = Array.isArray(rubric?.criteria) ? rubric.criteria : [];
  return criteria.map((c) => ({
    name: c?.name ?? "criterion",
    score: passed ? 100 : 0,
    max: 100,
    comment: passed ? "Met (tests passed)." : "Not met (tests failed).",
  }));
}

function numberOf(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function boolOf(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

/** Bound captured output so we never persist megabytes of stdout. */
function clip(s: string, max = 8000): string {
  if (typeof s !== "string") return "";
  return s.length > max ? s.slice(0, max) + "\n…(truncated)" : s;
}

function errorGrade(method: GradingMethod, err: unknown): AiGrade {
  return {
    status: "error",
    method,
    note: "needs manual review",
    error: err instanceof Error ? err.message : "Grading failed.",
    graded_at: nowIso(),
  };
}
