import { NextResponse } from "next/server";
import { requireOwnedProject } from "@/lib/builder/guard";
import { ensureRepo, listVersions, StorageError } from "@/lib/builder/storage";

type RouteParams = { params: Promise<{ projectId: string }> };

/** GET /api/builder/[projectId]/versions — commit history for the project. */
export async function GET(_request: Request, { params }: RouteParams) {
  const { projectId } = await params;
  const guard = await requireOwnedProject(projectId);
  if ("response" in guard) return guard.response;
  const { project } = guard;

  try {
    const repo = await ensureRepo(project.id);
    const versions = await listVersions(repo);
    return NextResponse.json({
      project: { id: project.id, name: project.name },
      versions,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof StorageError
            ? err.message
            : "Could not read version history.",
      },
      { status: 500 },
    );
  }
}
