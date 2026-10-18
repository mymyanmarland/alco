/**
 * Sandbox run orchestration (M5). Server-side only.
 *
 * materializeWorktree(): git-archive a project version into an ephemeral
 * temp dir (NOT inside storage/). detectProjectType(): package.json → node,
 * index.html at root → static. runSteps(): install + build for node,
 * no-op for static. The caller owns cleanup (see cleanupWorktree), except
 * when the caller registers the dir as a preview (preview.ts owns it then).
 *
 * Reuses M4's storage helpers for repo access; the worktree itself is built
 * with `git archive` via execFile (argv array — never shell interpolation).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  assertSafeProjectId,
  repoDir,
  StorageError,
} from "@/lib/builder/storage";
import { getSandboxDriver } from "./index";
import { LOCAL_SCRATCH_ROOT } from "./local-driver";
import type { SandboxDriver } from "./types";

const execFileAsync = promisify(execFile);

const SHA_RE = /^[0-9a-f]{5,40}$/;

export type ProjectType = "node" | "static";

export interface RunStep {
  name: "install" | "build" | "package";
  command: string[];
  network: "none" | "registry";
  timeoutMs: number;
}

export interface StepLog extends RunStep {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface RunResult {
  steps: StepLog[];
  /** Materialized output dir. Caller must cleanupWorktree() unless previewed. */
  outputDir: string;
  projectType: ProjectType;
  succeeded: boolean;
  timedOut: boolean;
}

/** Resolve + validate a sha against the project's own git history. */
async function resolveSha(repo: string, sha: string): Promise<string> {
  if (!SHA_RE.test(sha)) {
    throw new StorageError("Invalid snapshot ref");
  }
  let type: string;
  try {
    ({ stdout: type } = await execFileAsync("git", ["-C", repo, "cat-file", "-t", sha], {
      timeout: 15_000,
    }));
  } catch {
    throw new StorageError("Snapshot not found in this project");
  }
  if (type.trim() !== "commit") throw new StorageError("Not a commit");
  return (await execFileAsync("git", ["-C", repo, "rev-parse", sha], { timeout: 15_000 })).stdout.trim();
}

async function headSha(repo: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repo, "rev-parse", "HEAD"], {
      timeout: 15_000,
    });
    return stdout.trim();
  } catch {
    throw new StorageError("Project has no versions yet — generate code first");
  }
}

/**
 * Materialize the tree of `sha` (or HEAD) into a fresh temp dir.
 * Returns { dir, sha } — the resolved full sha actually materialized.
 */
export async function materializeWorktree(
  projectId: string,
  snapshotRef?: string,
): Promise<{ dir: string; sha: string }> {
  assertSafeProjectId(projectId);
  const repo = repoDir(projectId);
  const sha = snapshotRef ? await resolveSha(repo, snapshotRef) : await headSha(repo);

  await fs.mkdir(LOCAL_SCRATCH_ROOT, { recursive: true });
  const dir = await fs.mkdtemp(path.join(LOCAL_SCRATCH_ROOT, "run-"));
  // git archive <sha> | tar -x -C <dir> — argv only, no shell.
  const archive = execFile("git", ["-C", repo, "archive", sha]);
  const extract = execFile("tar", ["-x", "-C", dir]);
  const aOut = archive.stdout;
  const eIn = extract.stdin;
  if (!aOut || !eIn) {
    archive.kill();
    extract.kill();
    await cleanupWorktree(dir);
    throw new Error("worktree extract failed: stream unavailable");
  }
  aOut.pipe(eIn as NodeJS.WritableStream);
  await new Promise<void>((resolve, reject) => {
    extract.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`worktree extract failed (code ${code})`)),
    );
    archive.on("error", reject);
    extract.on("error", reject);
  });
  return { dir, sha };
}

export async function cleanupWorktree(dir: string): Promise<void> {
  const root = path.resolve(LOCAL_SCRATCH_ROOT);
  const resolved = path.resolve(dir);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error("cleanupWorktree: refusing to delete outside scratch root");
  }
  await fs.rm(resolved, { recursive: true, force: true });
}

async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    const st = await fs.stat(path.join(dir, name));
    return st.isFile();
  } catch {
    return false;
  }
}

/** package.json → node; root index.html → static; else unsupported. */
export async function detectProjectType(dir: string): Promise<ProjectType> {
  if (await fileExists(dir, "package.json")) return "node";
  if (await fileExists(dir, "index.html")) return "static";
  throw new StorageError(
    "Unsupported project type — expected package.json (node) or index.html (static) at the project root",
  );
}

function stepsFor(type: ProjectType): RunStep[] {
  if (type === "node") {
    return [
      {
        name: "install",
        command: ["npm", "install", "--no-audit", "--no-fund", "--no-update-notifier"],
        network: "registry",
        timeoutMs: 120_000,
      },
      {
        name: "build",
        command: ["npm", "run", "build"],
        network: "none",
        timeoutMs: 60_000,
      },
    ];
  }
  return [
    { name: "package", command: [], network: "none", timeoutMs: 5_000 },
  ];
}

export interface StreamHooks {
  onStepStart?: (step: RunStep) => void;
  onOutput?: (step: string, stream: "stdout" | "stderr", chunk: string) => void;
  onStepDone?: (log: StepLog) => void;
}

/**
 * Run the build steps for a materialized worktree. Streams progress via hooks.
 * Never throws on command failure — failures are reported in the StepLogs.
 */
export async function runSteps(
  dir: string,
  type: ProjectType,
  driver: SandboxDriver,
  hooks: StreamHooks = {},
  runTag?: string,
  onlySteps?: string[],
): Promise<{ steps: StepLog[]; succeeded: boolean; timedOut: boolean }> {
  const steps: StepLog[] = [];
  let timedOut = false;
  const wanted = onlySteps && onlySteps.length > 0 ? new Set(onlySteps) : null;
  for (const step of stepsFor(type)) {
    if (wanted && !wanted.has(step.name)) continue;
    hooks.onStepStart?.(step);
    if (step.command.length === 0) {
      // "package" for static projects: nothing to execute.
      const log: StepLog = {
        ...step,
        exitCode: 0,
        stdout: "static project — no build required",
        stderr: "",
        timedOut: false,
        durationMs: 0,
      };
      steps.push(log);
      hooks.onStepDone?.(log);
      continue;
    }
    const startedAt = Date.now();
    const out = await driver.run({
      workdir: dir,
      command: step.command,
      timeoutMs: step.timeoutMs,
      network: step.network,
      runTag,
      onOutput: (stream, chunk) => hooks.onOutput?.(step.name, stream, chunk),
    });
    const log: StepLog = {
      ...step,
      exitCode: out.exitCode,
      stdout: out.stdout,
      stderr: out.stderr,
      timedOut: out.timedOut,
      durationMs: Date.now() - startedAt,
    };
    steps.push(log);
    hooks.onStepDone?.(log);
    if (out.timedOut) {
      timedOut = true;
      break;
    }
    if (out.exitCode !== 0) break; // stop on first failing step
  }
  const succeeded = steps.length > 0 && steps.every((s) => s.exitCode === 0 && !s.timedOut);
  return { steps, succeeded, timedOut };
}

/** Convenience: materialize + detect + run, returning everything the API needs. */
export async function executeProject(
  projectId: string,
  snapshotRef: string | undefined,
  hooks: StreamHooks = {},
  runTag?: string,
  onlySteps?: string[],
): Promise<RunResult & { sha: string }> {
  const { dir, sha } = await materializeWorktree(projectId, snapshotRef);
  try {
    const type = await detectProjectType(dir);
    const driver = getSandboxDriver();
    const { steps, succeeded, timedOut } = await runSteps(dir, type, driver, hooks, runTag, onlySteps);
    return { steps, outputDir: dir, projectType: type, succeeded, timedOut, sha };
  } catch (err) {
    await cleanupWorktree(dir);
    throw err;
  }
}
