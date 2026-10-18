/**
 * GET /api/health — liveness probe for Docker HEALTHCHECK and uptime monitors.
 * Returns { ok, db } only. Never leaks connection strings, versions, or errors.
 */
import { connection, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  // Opt out of prerendering (Next 16 cacheComponents): health must be live.
  await connection();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return NextResponse.json({ ok: db, db });
}
