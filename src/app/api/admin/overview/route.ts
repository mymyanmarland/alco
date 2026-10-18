/**
 * GET /api/admin/overview — admin dashboard data (M6-A).
 * Gated by ADMIN_EMAILS; non-admins get 404. Booleans only for
 * configuration state — never keys, secrets, or connection strings.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/admin";
import { startOfToday } from "@/lib/quotas";

export async function GET() {
  // Dynamic by construction: requireAdmin() reads request headers via getSession().
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;

  const today = startOfToday();

  const [
    userCount,
    users,
    projectCount,
    failures,
    tokenAgg,
    sandboxAgg,
    dbOk,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        email: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    }),
    prisma.project.count(),
    prisma.sandboxRun.findMany({
      where: { status: { in: ["failed", "timeout"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        userId: true,
        projectId: true,
        status: true,
        exitCode: true,
        durationMs: true,
        driver: true,
        createdAt: true,
      },
    }),
    prisma.usageEvent.aggregate({
      _sum: { quantity: true },
      where: { kind: "ai_tokens", createdAt: { gte: today } },
    }),
    prisma.sandboxRun.aggregate({
      _sum: { durationMs: true },
      where: { createdAt: { gte: today } },
    }),
    prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    ),
  ]);

  const aiProvider = (process.env.AI_PROVIDER || "").toLowerCase();
  const aiConfigured = aiProvider !== "mock" && Boolean(process.env.AI_API_KEY);

  return NextResponse.json({
    users: {
      count: userCount,
      list: users.map((u) => ({
        id: u.id,
        email: u.email,
        createdAt: u.createdAt.toISOString(),
        projectCount: u._count.projects,
      })),
    },
    totals: { projects: projectCount },
    failures: failures.map((f) => ({
      id: f.id,
      userId: f.userId,
      projectId: f.projectId,
      status: f.status,
      exitCode: f.exitCode,
      durationMs: f.durationMs,
      driver: f.driver,
      createdAt: f.createdAt.toISOString(),
    })),
    usage: {
      aiTokensToday: Math.round(tokenAgg._sum.quantity ?? 0),
      sandboxMsToday: Math.round(sandboxAgg._sum.durationMs ?? 0),
    },
    health: {
      db: dbOk,
      sandboxDriver: process.env.SANDBOX_DRIVER || "local",
      aiConfigured,
    },
  });
}
