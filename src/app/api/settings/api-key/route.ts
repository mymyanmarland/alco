import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/get-session";
import { DEFAULT_PROVIDER } from "@/lib/apikeys";
import { encryptKey, keyHint, KeyCryptoError } from "@/lib/apikey-crypto";

const MIN_KEY_LEN = 20;

interface PublicKeyShape {
  configured: boolean;
  provider?: string;
  keyHint?: string;
  baseUrl?: string | null;
  createdAt?: string;
}

function toPublic(row: {
  provider: string;
  keyHint: string;
  baseUrl: string | null;
  createdAt: Date;
}): PublicKeyShape {
  return {
    configured: true,
    provider: row.provider,
    keyHint: row.keyHint,
    baseUrl: row.baseUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

/** GET /api/settings/api-key — public shape only; never the key/ciphertext. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const row = await prisma.userApiKey.findUnique({
    where: { userId_provider: { userId, provider: DEFAULT_PROVIDER } },
    select: { provider: true, keyHint: true, baseUrl: true, createdAt: true },
  });
  if (!row) return NextResponse.json({ configured: false });
  return NextResponse.json(toPublic(row));
}

/**
 * POST /api/settings/api-key — { key, baseUrl? } → upsert (userId, provider).
 * The key is encrypted before storage; the response never echoes it.
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { key?: unknown; baseUrl?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key.length < MIN_KEY_LEN) {
    return NextResponse.json(
      { error: "Key must be at least 20 characters." },
      { status: 400 },
    );
  }

  let baseUrl: string | null = null;
  if (body.baseUrl !== undefined && body.baseUrl !== null) {
    const raw = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
    if (raw) {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        return NextResponse.json(
          { error: "baseUrl must be a valid URL." },
          { status: 400 },
        );
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return NextResponse.json(
          { error: "baseUrl must use http or https." },
          { status: 400 },
        );
      }
      baseUrl = url.toString().replace(/\/$/, "");
    }
  }

  let encryptedKey: string;
  try {
    encryptedKey = encryptKey(key);
  } catch (err) {
    // Server misconfiguration (APP_ENCRYPTION_KEY) — fail closed, no retry.
    return NextResponse.json(
      {
        error: "server_misconfigured",
        message:
          err instanceof KeyCryptoError
            ? err.message
            : "Could not store the key securely.",
      },
      { status: 500 },
    );
  }

  const row = await prisma.userApiKey.upsert({
    where: { userId_provider: { userId, provider: DEFAULT_PROVIDER } },
    create: {
      userId,
      provider: DEFAULT_PROVIDER,
      encryptedKey,
      keyHint: keyHint(key),
      baseUrl,
    },
    update: { encryptedKey, keyHint: keyHint(key), baseUrl },
    select: { provider: true, keyHint: true, baseUrl: true, createdAt: true },
  });
  return NextResponse.json(toPublic(row));
}

/** DELETE /api/settings/api-key — removes the user's stored key. */
export async function DELETE() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await prisma.userApiKey.deleteMany({
    where: { userId, provider: DEFAULT_PROVIDER },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "No API key configured." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
