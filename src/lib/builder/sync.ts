/**
 * Syncs the project_files table from the git worktree (source of truth).
 * Server-side only.
 */
import { prisma } from "@/lib/prisma";
import { listTrackedFiles } from "./storage";

/** Rebuild project_files rows to mirror the repo's tracked files. */
export async function syncProjectFiles(
  projectId: string,
  repo: string,
): Promise<{ path: string; sizeBytes: number }[]> {
  const tracked = await listTrackedFiles(repo);
  const seen = new Set<string>();
  for (const f of tracked) {
    seen.add(f.path);
    await prisma.projectFile.upsert({
      where: { projectId_path: { projectId, path: f.path } },
      update: { sizeBytes: f.sizeBytes },
      create: { projectId, path: f.path, sizeBytes: f.sizeBytes },
    });
  }
  await prisma.projectFile.deleteMany({
    where: { projectId, path: { notIn: [...seen] } },
  });
  return tracked;
}
