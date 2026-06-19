// Provider-agnostic grading sandbox (Prompt 6). SERVER-ONLY.
//
// SECURITY MODEL — candidate code is UNTRUSTED:
//   * Runs in an isolated Vercel Sandbox MicroVM (one per submission).
//   * NO secrets are ever passed into the sandbox env. We deliberately create
//     the sandbox with an EMPTY env and never forward SUPABASE_* /
//     ANTHROPIC_API_KEY / VERCEL_* into the candidate runtime.
//   * Short wall-clock timeout + minimal vCPU caps bound resource use.
//   * No access to internal services — the sandbox only has whatever default
//     network egress Vercel Sandbox grants; we pass no internal URLs/creds.
//
// All Vercel-Sandbox specifics live in THIS file so the provider is swappable:
// to change providers, implement `GradingSandbox` and update `getGradingSandbox()`.

import { Sandbox } from "@vercel/sandbox";

/** Opaque handle to a running sandbox, provider-specific. */
export interface SandboxHandle {
  // Kept generic so providers can stash their native object.
  readonly id: string;
  readonly native: unknown;
}

export interface CreateOpts {
  runtime: "node" | "python";
  timeoutMs: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The swap point. Implement this to back grading with another provider. */
export interface GradingSandbox {
  create(opts: CreateOpts): Promise<SandboxHandle>;
  writeFiles(
    handle: SandboxHandle,
    files: { path: string; content: string }[],
  ): Promise<void>;
  run(
    handle: SandboxHandle,
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): Promise<RunResult>;
  destroy(handle: SandboxHandle): Promise<void>;
}

// Hard caps for untrusted code. Kept conservative on purpose.
const MAX_TIMEOUT_MS = 120_000;
const SANDBOX_VCPUS = 1;

/** Map our coarse runtime to a concrete Vercel Sandbox runtime id. */
function vercelRuntime(runtime: "node" | "python"): string {
  return runtime === "python" ? "python3.13" : "node24";
}

/**
 * Resolve EXPLICIT Vercel credentials from server-only env. When these are
 * absent we return `undefined`, and the SDK falls back to the platform OIDC
 * token automatically (the normal path in production on Vercel).
 *
 * These vars are SERVER-ONLY (never VITE_*) and are NEVER forwarded into the
 * candidate sandbox env.
 */
function explicitCredentials():
  | { token: string; teamId: string; projectId: string }
  | undefined {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (token && teamId && projectId) return { token, teamId, projectId };
  return undefined;
}

/** Real implementation against @vercel/sandbox. */
export class VercelGradingSandbox implements GradingSandbox {
  async create(opts: CreateOpts): Promise<SandboxHandle> {
    const timeout = Math.min(opts.timeoutMs, MAX_TIMEOUT_MS);
    const creds = explicitCredentials();

    // IMPORTANT: env is intentionally EMPTY — no secrets enter the sandbox.
    const params = {
      runtime: vercelRuntime(opts.runtime),
      timeout,
      resources: { vcpus: SANDBOX_VCPUS },
      env: {} as Record<string, string>,
      ...(creds ?? {}),
    };

    const sandbox = await Sandbox.create(params as never);
    return { id: sandbox.name, native: sandbox };
  }

  async writeFiles(
    handle: SandboxHandle,
    files: { path: string; content: string }[],
  ): Promise<void> {
    const sandbox = handle.native as Sandbox;
    if (files.length === 0) return;
    await sandbox.writeFiles(
      files.map((f) => ({ path: f.path, content: f.content })),
    );
  }

  async run(
    handle: SandboxHandle,
    cmd: string,
    args: string[],
    timeoutMs: number,
  ): Promise<RunResult> {
    const sandbox = handle.native as Sandbox;
    const finished = await sandbox.runCommand(cmd, args, {
      timeoutMs: Math.min(timeoutMs, MAX_TIMEOUT_MS),
    });
    const [stdout, stderr] = await Promise.all([
      finished.stdout(),
      finished.stderr(),
    ]);
    return { stdout, stderr, exitCode: finished.exitCode };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const sandbox = handle.native as Sandbox;
    await sandbox.stop();
  }
}

/**
 * Fallback used only if the sandbox provider is unavailable. Every "run"
 * surfaces as a non-zero exit with a clear message so grading methods route to
 * needs_manual_review rather than silently passing or failing.
 */
export class NotConfiguredSandbox implements GradingSandbox {
  async create(): Promise<SandboxHandle> {
    return { id: "not-configured", native: null };
  }
  async writeFiles(): Promise<void> {
    /* no-op */
  }
  async run(): Promise<RunResult> {
    return {
      stdout: "",
      stderr: "Grading sandbox is not configured on this deployment.",
      exitCode: 127,
    };
  }
  async destroy(): Promise<void> {
    /* no-op */
  }
}

/**
 * Factory / swap point. Returns the Vercel-backed sandbox; if the module is
 * unavailable for any reason, falls back to NotConfiguredSandbox so callers can
 * still produce a needs_manual_review grade instead of crashing.
 */
export function getGradingSandbox(): GradingSandbox {
  try {
    // `Sandbox` is statically imported; this guards against a broken install.
    if (typeof Sandbox?.create !== "function") {
      return new NotConfiguredSandbox();
    }
    return new VercelGradingSandbox();
  } catch {
    return new NotConfiguredSandbox();
  }
}
