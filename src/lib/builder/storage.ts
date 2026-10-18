/**
 * Git-backed project file storage (M4). Server-side only.
 *
 * Layout: <STORAGE_DIR>/projects/<projectId>/  — one git repo per project.
 * Versions = git commits; rollback = a NEW commit restoring an old tree
 * (history is never rewritten).
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MAX_FILES_PER_PROJECT = 200;
export const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file

const ALLOWED_EXTENSIONS = new Set([
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "json",
  "md",
  "mdx",
  "txt",
  "svg",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ico",
  "webmanifest",
]);

export function storageRoot(): string {
  // turbopackIgnore: storage dir is runtime data, not deployable source.
  return path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    process.env.STORAGE_DIR || "storage",
  );
}

/** projectId must be a safe directory name (cuid-shaped). Throws otherwise. */
export function assertSafeProjectId(projectId: string): void {
  if (!/^[a-z0-9]{10,64}$/.test(projectId)) {
    throw new StorageError("Invalid project id");
  }
}

export function repoDir(projectId: string): string {
  assertSafeProjectId(projectId);
  return path.join(storageRoot(), "projects", projectId);
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Validate a user/model-supplied relative file path. Returns the normalized
 * posix path. Throws StorageError on traversal, absolute paths, bad
 * extensions, or empty paths.
 */
export function validateFilePath(rawPath: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new StorageError("File path is required");
  }
  const normalized = path.posix.normalize(rawPath.replace(/\\/g, "/"));
  if (
    normalized === "" ||
    normalized === "." ||
    normalized.startsWith("..") ||
    path.posix.isAbsolute(normalized) ||
    normalized.startsWith("/")
  ) {
    throw new StorageError(`Rejected unsafe path: ${rawPath}`);
  }
  const ext = normalized.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new StorageError(`File extension not allowed: .${ext}`);
  }
  if (normalized.length > 256) {
    throw new StorageError("File path too long");
  }
  return normalized;
}

/** Resolve a validated relative path inside the repo; never escapes. */
function resolveInRepo(repo: string, relPath: string): string {
  const resolved = path.resolve(repo, relPath);
  if (resolved !== repo && !resolved.startsWith(repo + path.sep)) {
    throw new StorageError("Path escapes project directory");
  }
  return resolved;
}

async function git(
  repo: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", ["-C", repo, ...args], {
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

export interface RepoVersion {
  sha: string;
  message: string;
  date: string;
}

/** Create the repo on first use (idempotent). */
export async function ensureRepo(projectId: string): Promise<string> {
  const repo = repoDir(projectId);
  await fs.mkdir(repo, { recursive: true });
  try {
    await fs.access(path.join(repo, ".git"));
  } catch {
    await execFileAsync("git", ["init", "-q", repo], { timeout: 30_000 });
    await git(repo, ["config", "user.name", "ALCO Builder"]);
    await git(repo, ["config", "user.email", "builder@alco-os.local"]);
  }
  return repo;
}

export async function writeProjectFile(
  repo: string,
  relPath: string,
  content: string,
): Promise<number> {
  const safe = validateFilePath(relPath);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_FILE_BYTES) {
    throw new StorageError(`File too large (max ${MAX_FILE_BYTES} bytes)`);
  }
  const abs = resolveInRepo(repo, safe);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return bytes;
}

export async function readProjectFile(
  repo: string,
  relPath: string,
): Promise<string> {
  const safe = validateFilePath(relPath);
  const abs = resolveInRepo(repo, safe);
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    throw new StorageError("File not found");
  }
}

/** List tracked files (from the git index) with sizes. */
export async function listTrackedFiles(
  repo: string,
): Promise<{ path: string; sizeBytes: number }[]> {
  let out: string;
  try {
    ({ stdout: out } = await git(repo, ["ls-files", "-z"]));
  } catch {
    return [];
  }
  const files: { path: string; sizeBytes: number }[] = [];
  for (const p of out.split("\0").filter(Boolean)) {
    try {
      const st = await fs.stat(resolveInRepo(repo, p));
      files.push({ path: p, sizeBytes: st.isFile() ? st.size : 0 });
    } catch {
      // skip unreadable entries
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Stage everything and commit. Returns the new HEAD sha, or the current HEAD
 * when there is nothing to commit, or null when the repo has no commits yet.
 */
export async function commitAll(
  repo: string,
  message: string,
): Promise<string | null> {
  await git(repo, ["add", "-A"]);
  const { stdout: status } = await git(repo, ["status", "--porcelain"]);
  if (!status.trim()) {
    return headSha(repo);
  }
  await git(repo, ["commit", "-q", "-m", message.slice(0, 500)]);
  return headSha(repo);
}

export async function headSha(repo: string): Promise<string | null> {
  try {
    const { stdout } = await git(repo, ["rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function listVersions(
  repo: string,
  limit = 50,
): Promise<RepoVersion[]> {
  try {
    const { stdout } = await git(repo, [
      "log",
      `--max-count=${Math.min(limit, 200)}`,
      "--format=%H%x1f%s%x1f%cI",
    ]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, message, date] = line.split("");
        return { sha, message, date };
      });
  } catch {
    return [];
  }
}

/**
 * Rollback by creating a NEW commit that restores the tree of `sha`.
 * History is never rewritten. Returns the new commit sha.
 */
export async function rollbackToSha(
  repo: string,
  sha: string,
  origMessage: string,
): Promise<string> {
  if (!/^[0-9a-f]{5,40}$/.test(sha)) {
    throw new StorageError("Invalid commit sha");
  }
  let type: string;
  try {
    ({ stdout: type } = await git(repo, ["cat-file", "-t", sha]));
  } catch {
    throw new StorageError("Commit not found in this project");
  }
  if (type.trim() !== "commit") {
    throw new StorageError("Not a commit");
  }
  const full = (await git(repo, ["rev-parse", sha])).stdout.trim();
  // Restore the old tree into the worktree, then commit it as new history.
  await git(repo, ["rm", "-qr", "."]).catch(() => undefined);
  await git(repo, ["checkout", full, "--", "."]);
  await git(repo, ["add", "-A"]);
  const short = full.slice(0, 7);
  await git(repo, [
    "commit",
    "-q",
    "-m",
    `Rollback to ${short}: ${origMessage}`.slice(0, 500),
  ]);
  const newSha = await headSha(repo);
  if (!newSha) throw new StorageError("Rollback commit failed");
  return newSha;
}
