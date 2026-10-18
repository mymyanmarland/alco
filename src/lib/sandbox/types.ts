/**
 * Sandbox driver types (M5). Server-side only.
 *
 * A driver executes an untrusted command inside an isolated environment and
 * returns the captured result. Drivers NEVER see host secrets and NEVER run
 * outside their designated work directory / container.
 */

export type SandboxNetwork = "none" | "registry";

export interface RunOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** True when the driver killed the command for exceeding the timeout. */
  timedOut: boolean;
  /** True when output was truncated by the driver's buffer cap. */
  truncated: boolean;
  durationMs: number;
}

export interface RunOptions {
  /** Absolute, validated working directory for the command. */
  workdir: string;
  /** argv array — NEVER a shell string. */
  command: string[];
  /** Hard timeout in ms. Driver must kill the process on expiry. */
  timeoutMs: number;
  /** "none" = no network; "registry" = package-registry egress only. */
  network: SandboxNetwork;
  /** Extra env vars (allowlist). PATH/HOME are always set by the driver. */
  env?: Record<string, string>;
  /**
   * Optional live-output hook. Called with decoded chunks as they arrive.
   * Used by the API route to forward logs over SSE.
   */
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  /** Short id used for container naming / log correlation (docker driver). */
  runTag?: string;
}

export interface SandboxDriver {
  readonly name: "docker" | "local";
  run(opts: RunOptions): Promise<RunOutput>;
}

/** Per-run resource policy shared by all drivers. */
export const RUN_LIMITS = {
  /** Hard cap for any single driver invocation. */
  maxTimeoutMs: 180_000,
  /** Per-stream output cap before truncation. */
  maxOutputBytes: 1_048_576, // 1 MiB
  /** Max concurrent sandbox runs per user (M5: enforced in-process). */
  maxConcurrentPerUser: 2,
  /** Daily execution budget per user (M5: enforced via sandbox_runs). */
  dailyExecutionMs: 10 * 60_000, // 10 minutes
} as const;
