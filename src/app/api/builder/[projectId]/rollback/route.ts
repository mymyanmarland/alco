import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOwnedProject } from "@/lib/builder/guard";
import {
  ensureRepo,
  listVersions,
  rollbackToSha,
  StorageError,
} from "@/lib/builder/storage";
import { syncProjectFiles } from "@/lib/builder/sync";

type RouteParams = { params: Promise<{ projectId: string }> };

/**
 * POST /api/builder/[projectId]/rollback — { sha }.
 * Restores an old version by creating a NEW commit (history is never
 * rewritten). Updates project_files metadata to match.
 */
export async function POST(request: Request, { params }: RouteParams) {
  const { projectId } = await params;
  const guard = await requireOwnedProject(projectId);
  if ("response" in guard) return guard.response;
  const { project } = guard;

  let body: { sha?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.sha !== "string" || !body.sha) {
    return NextResponse.json(
      { error: "sha is required" },
      { status: 400 },
    );
  }

  try {
    const repo = await ensureRepo(project.id);
    // Only allow rollback to a sha that exists in this project's history.
    const versions = await listVersions(repo, 200);
    const target = versions.find(
      (v) => v.sha === body.sha || v.sha.startsWith(body.sha as string),
    );
    if (!target) {
      return NextResponse.json(
        { error: "Version not found in this project" },
        { status: 404 },
      );
    }
    const commitSha = await rollbackToSha(repo, target.sha, target.message);
    await syncProjectFiles(project.id, repo);
    const version = await prisma.projectVersion.create({
      data: {
        projectId: project.id,
        message: `Rollback to ${target.sha.slice(0, 7)}: ${target.message}`,
        snapshotRef: commitSha,
      },
    });
    await prisma.project.update({
      where: { id: project.id },
      data: { updatedAt: new Date() },
    });
    return NextResponse.json({
      commitSha,
      version: {
        id: version.id,
        message: version.message,
        snapshotRef: commitSha,
      },
    });
  } catch (err) {
    const message =
      err instanceof StorageError ? err.message : "Rollback failed.";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
