/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DEV / TEST ONLY — NEVER USE IN PRODUCTION.
 * ═══════════════════════════════════════════════════════════════════════════
 *  This driver runs commands directly on the host via child_process.spawn.
 *  It is suitable ONLY for local development and automated tests where the
 *  executed code is already trusted (e.g. the mock builder's fixtures).
 *
 *  It MUST NOT be used to execute untrusted user/AI-generated code in any
 *  deployed environment. Production MUST use the Docker driver
 *  (SANDBOX_DRIVER=docker). The driver refuses to run when
 *  NODE_ENV=production unless SANDBOX_ALLOW_LOCAL=1 is explicitly set.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { spawn } from "node:child_process";
import { constants as fsConstants, statSync, accessSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RUN_LIMITS, type RunOptions, type RunOutput, type SandboxDriver } from "./types";

/**
 * Scratch root for materialized worktrees. Shared with runner.ts, which
 * creates its temp dirs inside this root. Driver refuses anything outside.
 */
export const LOCAL_SCRATCH_ROOT: string = path.join(os.tmpdir(), "alco-sbx-runs");

export function localScratchRoot(): string {
  return LOCAL_SCRATCH_ROOT;
}

function assertJailedDir(workdir: string): void {
  const root = path.resolve(LOCAL_SCRATCH_ROOT);
  const dir = path.resolve(workdir);
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error(
      "local-driver: workdir escapes the sandbox scratch root — refused",
    );
  }
}

/**
 * Resolve a binary name against the HOST's PATH (the app server's own PATH,
 * never passed to the child). Lets the driver find tools like npm/node that
 * live outside the scrubbed child PATH, without leaking host env into runs.
 */
function resolveBin(name: string): string {
  if (name.includes("/") || process.platform === "win32") return name;
  const hostPath = process.env.PATH ?? "";
  for (const dir of hostPath.split(":")) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // not here — keep looking
    }
  }
  return name; // let spawn report ENOENT honestly
}

export class LocalDriver implements SandboxDriver {
  readonly name = "local" as const;

  async run(opts: RunOptions): Promise<RunOutput> {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.SANDBOX_ALLOW_LOCAL !== "1"
    ) {
      throw new Error(
        "local-driver: REFUSED — the local driver is dev/test only and " +
          "NODE_ENV=production. Set SANDBOX_DRIVER=docker.",
      );
    }
    assertJailedDir(opts.workdir);
    if (!Array.isArray(opts.command) || opts.command.length === 0) {
      throw new Error("local-driver: command must be a non-empty argv array");
    }
    const timeoutMs = Math.min(opts.timeoutMs, RUN_LIMITS.maxTimeoutMs);
    const startedAt = Date.now();

    // Scrubbed environment: PATH + HOME + explicit allowlist ONLY.
    // process.env is NEVER spread here.
    const env: Record<string, string> = {
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: opts.workdir,
      ...opts.env,
    };

    return new Promise<RunOutput>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let timedOut = false;

      const child = spawn(resolveBin(opts.command[0]), opts.command.slice(1), {
        cwd: opts.workdir,
        // Cast: the object above is deliberately NOT process.env.
        env: env as NodeJS.ProcessEnv,
        shell: false, // NEVER a shell — argv only.
        stdio: ["ignore", "pipe", "pipe"] as const,
        // No spawn-level timeout: the explicit watchdog above owns killing.
      });

      const append = (
        stream: "stdout" | "stderr",
        chunk: Buffer | string,
      ): void => {
        const text = chunk.toString("utf8");
        const cap = RUN_LIMITS.maxOutputBytes;
        if (stream === "stdout") {
          if (stdout.length + text.length > cap) {
            stdout += text.slice(0, Math.max(0, cap - stdout.length));
            truncated = true;
          } else {
            stdout += text;
          }
        } else {
          if (stderr.length + text.length > cap) {
            stderr += text.slice(0, Math.max(0, cap - stderr.length));
            truncated = true;
          } else {
            stderr += text;
          }
        }
        try {
          opts.onOutput?.(stream, text);
        } catch {
          // onOutput must never break the run
        }
      };

      // Explicit watchdog: SIGTERM first, SIGKILL after a grace period.
      const watchdog = setTimeout(() => {
        timedOut = true;
        try {
          child.kill("SIGTERM");
        } catch {
          // already gone
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already gone
          }
        }, 2000).unref?.();
      }, timeoutMs);
      if (typeof watchdog.unref === "function") watchdog.unref();

      child.stdout.on("data", (d) => append("stdout", d));
      child.stderr.on("data", (d) => append("stderr", d));
      child.on("error", (err) => {
        clearTimeout(watchdog);
        reject(
          new Error(`local-driver: failed to spawn: ${(err as Error).message}`),
        );
      });
      child.on("close", (code) => {
        clearTimeout(watchdog);
        resolve({
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          timedOut,
          truncated,
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}
