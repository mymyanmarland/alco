/**
 * GET /api/sandbox/preview/[runId]/[[...path]]?token=… — serve files from an
 * ephemeral static preview. Token (timing-safe) + TTL enforced; paths are
 * jailed to the preview dir; no directory listing.
 *
 * M5 serves via the Next.js app itself (local driver). With the Docker
 * driver in production (M6) this becomes a per-run container behind a
 * reverse proxy — the token/TTL plumbing here stays the same.
 */
import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { checkPreview, resolvePreviewPath } from "@/lib/sandbox/preview";


const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
};

function contentTypeFor(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string; path?: string[] }> },
) {
  const { runId, path: segments } = await params;
  const token = new URL(req.url).searchParams.get("token") ?? "";

  const check = checkPreview(runId, token);
  if (!check.ok) {
    const status = check.reason === "not_found" ? 404 : 403;
    const message =
      check.reason === "expired"
        ? "Preview expired"
        : check.reason === "not_found"
          ? "Preview not found"
          : "Invalid preview token";
    return NextResponse.json({ error: message }, { status });
  }

  const rel = (segments ?? []).filter((s) => s && s !== "." && s !== "..");
  let target = resolvePreviewPath(check.dir, rel);
  if (!target) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  try {
    const st = await fs.stat(target);
    if (st.isDirectory()) {
      target = path.join(target, "index.html");
      await fs.access(target);
    }
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(target);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor(target),
      "Cache-Control": "no-store",
      // Previews are untrusted generated content: never same-origin script access.
      "Content-Security-Policy": "sandbox allow-scripts",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
