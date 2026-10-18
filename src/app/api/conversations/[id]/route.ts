import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";

type RouteParams = { params: Promise<{ id: string }> };

/** Ownership-scoped lookup: a user can only ever touch their own conversation. */
async function findOwnedConversation(id: string, userId: string) {
  return prisma.conversation.findFirst({ where: { id, userId } });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await findOwnedConversation(id, userId);
  if (!existing) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }
  // Messages cascade-delete via the Prisma schema relation.
  await prisma.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
