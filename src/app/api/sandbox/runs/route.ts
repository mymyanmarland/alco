/**
 * GET /api/sandbox/runs — my sandbox execution history (newest first).
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";


export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("limit") ?? 50), 1),
    100,
  );
  const runs = await prisma.sandboxRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      projectId: true,
      project: { select: { name: true } },
      runtime: true,
      status: true,
      exitCode: true,
      durationMs: true,
      driver: true,
      snapshotRef: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ runs });
}
