import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";

type RouteParams = { params: Promise<{ id: string }> };

/** Ownership-scoped lookup: a user can only ever touch their own project. */
async function findOwnedProject(id: string, userId: string) {
  return prisma.project.findFirst({ where: { id, userId } });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await findOwnedProject(id, userId);
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const data: { name?: string; description?: string | null } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name || name.length > 120) {
      return NextResponse.json(
        { error: "Project name is required (max 120 chars)" },
        { status: 400 },
      );
    }
    data.name = name;
  }
  if (typeof body.description === "string") {
    data.description = body.description.trim() || null;
  }
  const project = await prisma.project.update({
    where: { id: existing.id },
    data,
    select: {
      id: true,
      name: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await findOwnedProject(id, userId);
  if (!existing) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  await prisma.project.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
