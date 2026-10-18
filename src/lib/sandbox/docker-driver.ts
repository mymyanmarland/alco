/**
 * Docker sandbox driver (PRODUCTION). Server-side only.
 *
 * Executes the command inside an ephemeral, heavily restricted container:
 *
 *   docker run --rm -i \
 *     --name sbx-<tag> \
 *     --network none                     (or default bridge for "registry") \
 *     --cpus 0.5 --memory 512m --pids-limit 64 \
 *     --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
 *     --user <SANDBOX_RUN_UID:-65532>:<SANDBOX_RUN_UID:-65532> \
 *     --cap-drop ALL --security-opt no-new-privileges:true \
 *     --env PATH=... [--env ALLOWLIST...] \
 *     -v <workdir>:/workspace:rw -w /workspace \
 *     node:22-slim <argv...>
 *
 * Security properties:
 * - No host environment is ever passed through (allowlist only).
 * - argv only — never a shell string.
 * - Fail-closed: if Docker is unavailable the run throws a clear error.
 * - Driver-side timeout kills the container (SIGKILL via `docker kill`).
 *
 * VPS note (M6): the app process must be able to chown the workdir to the
 * run UID (i.e. run as root) or set SANDBOX_RUN_UID to a UID the app owns.
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { promisify } from "node:util";
import {
  RUN_LIMITS,
  type RunOptions,
  type RunOutput,
  type SandboxDriver,
} from "./types";

const execFileAsync = promisify(execFile);

const IMAGE = "node:22-slim";
const RUN_UID = process.env.SANDBOX_RUN_UID ?? "65532";

let dockerChecked: boolean | null = null;

async function ensureDocker(): Promise<void> {
  if (dockerChecked !== null) {
    if (!dockerChecked) throw new Error(dockerUnavailableMessage());
    return;
  }
  try {
    await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
      timeout: 10_000,
    });
    dockerChecked = true;
  } catch {
    dockerChecked = false;
    throw new Error(dockerUnavailableMessage());
  }
}

function dockerUnavailableMessage(): string {
  return (
    "docker-driver: Docker is not available on this host. " +
    "Sandbox execution cannot run — failing closed. " +
    "(Set SANDBOX_DRIVER=local for dev/test only.)"
  );
}

/** Best-effort container cleanup; never throws. */
async function killContainer(name: string): Promise<void> {
  try {
    await execFileAsync("docker", ["kill", name], { timeout: 10_000 });
  } catch {
    // already gone
  }
  try {
    await execFileAsync("docker", ["rm", "-f", name], { timeout: 10_000 });
  } catch {
    // already gone
  }
}

export class DockerDriver implements SandboxDriver {
  readonly name = "docker" as const;

  async run(opts: RunOptions): Promise<RunOutput> {
    await ensureDocker();
    if (!Array.isArray(opts.command) || opts.command.length === 0) {
      throw new Error("docker-driver: command must be a non-empty argv array");
    }
    const timeoutMs = Math.min(opts.timeoutMs, RUN_LIMITS.maxTimeoutMs);
    const startedAt = Date.now();
    const tag = (opts.runTag ?? `r${Date.now().toString(36)}`).replace(
      /[^a-zA-Z0-9_.-]/g,
      "",
    );
    const name = `sbx-${tag}`.slice(0, 64);

    // The workdir must be writable by the unprivileged run user.
    try {
      await fs.chown(opts.workdir, Number(RUN_UID), Number(RUN_UID));
    } catch (err) {
      throw new Error(
        `docker-driver: cannot chown workdir to UID ${RUN_UID} ` +
          `(run the app as root or set SANDBOX_RUN_UID): ${(err as Error).message}`,
      );
    }

    const args: string[] = [
      "run",
      "--rm",
      "-i",
      "--name",
      name,
      "--cpus",
      "0.5",
      "--memory",
      "512m",
      "--pids-limit",
      "64",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--user",
      `${RUN_UID}:${RUN_UID}`,
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges:true",
      "--env",
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "--env",
      "HOME=/tmp",
      "--env",
      "NPM_CONFIG_CACHE=/tmp/npm-cache",
      "--env",
      "CI=true",
    ];
    if (opts.network === "none") {
      args.push("--network", "none");
    }
    // "registry": default bridge network (restricted by cap-drop + read-only
    // rootfs + no-new-privileges; egress filtering is a VPS-level concern).
    for (const [k, v] of Object.entries(opts.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
      args.push("--env", `${k}=${v}`);
    }
    args.push("-v", `${opts.workdir}:/workspace:rw`, "-w", "/workspace");
    args.push(IMAGE, ...opts.command);

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      void killContainer(name);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    try {
      const child = await new Promise<{
        code: number;
        out: string;
        err: string;
      }>((resolve, reject) => {
        const proc = execFile("docker", args, {
          timeout: timeoutMs + 15_000, // driver timer fires first
          maxBuffer: RUN_LIMITS.maxOutputBytes * 2 + 1024,
          killSignal: "SIGKILL",
        });
        let out = "";
        let err = "";
        proc.stdout?.on("data", (d: Buffer) => {
          const t = d.toString("utf8");
          out += t;
          try {
            opts.onOutput?.("stdout", t);
          } catch {
            // never break the run
          }
        });
        proc.stderr?.on("data", (d: Buffer) => {
          const t = d.toString("utf8");
          err += t;
          try {
            opts.onOutput?.("stderr", t);
          } catch {
            // never break the run
          }
        });
        proc.on("error", reject);
        proc.on("close", (code) => resolve({ code: code ?? 1, out, err }));
      });
      stdout = child.out.slice(0, RUN_LIMITS.maxOutputBytes);
      stderr = child.err.slice(0, RUN_LIMITS.maxOutputBytes);
      truncated =
        child.out.length > RUN_LIMITS.maxOutputBytes ||
        child.err.length > RUN_LIMITS.maxOutputBytes;
      return {
        exitCode: timedOut ? 124 : child.code,
        stdout,
        stderr,
        timedOut,
        truncated,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
      if (timedOut) await killContainer(name);
    }
  }
}
