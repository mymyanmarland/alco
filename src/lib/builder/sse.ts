/** Shared SSE helpers for builder routes. Server-side only. */

export type BuilderEvent =
  | { type: "plan"; plan: unknown }
  | { type: "file"; path: string; status: "started" | "done" | "error"; message?: string; bytes?: number }
  | { type: "done"; commitSha?: string | null; files?: { path: string; bytes: number }[] }
  | { type: "error"; code: string; message: string };

const encoder = new TextEncoder();

export function sseEncode(event: BuilderEvent): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** Generic SSE encoder for non-builder event shapes (e.g. sandbox runs). */
export function sseEncodeJson(event: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(event)}\n\n`);
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}
