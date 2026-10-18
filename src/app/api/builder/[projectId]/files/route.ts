import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnedProject } from "@/lib/builder/guard";
import {
  ensureRepo,
  listTrackedFiles,
  readProjectFile,
  StorageError,
  validateFilePath,
} from "@/lib/builder/storage";

type RouteParams = { params: Promise<{ projectId: string }> };

/**
 * GET /api/builder/[projectId]/files[?path=...]
 * Without ?path: lists files (path, sizeBytes, updatedAt) from metadata.
 * With ?path: returns the file's content (path-validated, ownership-checked).
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { projectId } = await params;
  const guard = await requireOwnedProject(projectId);
  if ("response" in guard) return guard.response;
  const { project } = guard;

  const url = new URL(request.url);
  const queryPath = url.searchParams.get("path");

  try {
    const repo = await ensureRepo(project.id);

    if (queryPath === null) {
      const files = await prisma.projectFile.findMany({
        where: { projectId: project.id },
        select: { path: true, sizeBytes: true, updatedAt: true },
        orderBy: { path: "asc" },
      });
      // Fall back to the worktree when metadata is empty (e.g. legacy).
      if (files.length === 0) {
        const tracked = await listTrackedFiles(repo);
        return NextResponse.json({
          files: tracked.map((f) => ({
            path: f.path,
            sizeBytes: f.sizeBytes,
            updatedAt: null,
          })),
        });
      }
      return NextResponse.json({ files });
    }

    const safePath = validateFilePath(queryPath);
    const content = await readProjectFile(repo, safePath);
    return NextResponse.json({ path: safePath, content });
  } catch (err) {
    if (err instanceof StorageError) {
      const status = err.message.includes("not found") ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json(
      { error: "Could not read file." },
      { status: 500 },
    );
  }
}
