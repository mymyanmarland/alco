/**
 * Auth + project-ownership guard shared by builder routes. Server-side only.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";
import { assertSafeProjectId } from "./storage";

export interface OwnedProject {
  id: string;
  userId: string;
  name: string;
}

type GuardOk = { userId: string; project: OwnedProject };
type GuardFail = { response: NextResponse };

/**
 * Returns the user + owned project, or a ready-to-return 401/404 response.
 * `projectId` may come from body or route params; its shape is validated
 * before any DB or filesystem access.
 */
export async function requireOwnedProject(
  projectId: unknown,
): Promise<GuardOk | GuardFail> {
  const userId = await requireUserId();
  if (!userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (typeof projectId !== "string") {
    return {
      response: NextResponse.json(
        { error: "projectId is required" },
        { status: 400 },
      ),
    };
  }
  try {
    assertSafeProjectId(projectId);
  } catch {
    return {
      response: NextResponse.json(
        { error: "Invalid project id" },
        { status: 400 },
      ),
    };
  }
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true, userId: true, name: true },
  });
  if (!project) {
    return {
      response: NextResponse.json(
        { error: "Project not found" },
        { status: 404 },
      ),
    };
  }
  return { userId, project };
}
