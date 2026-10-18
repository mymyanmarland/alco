/**
 * Admin access control (M6-A). Server-side only.
 *
 * Admins are identified by email via the ADMIN_EMAILS env var
 * (comma-separated, case-insensitive). Non-admins get a 404 — the
 * admin surface must not reveal its own existence.
 */
import { NextResponse } from "next/server";
import { getSession } from "./get-session";

/** Admin emails from env, normalized. Empty list = no admins. */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.toLowerCase());
}

type AdminOk = { userId: string; email: string };
type AdminFail = { response: NextResponse };

/**
 * Returns the admin identity, or a ready-to-return 404 response.
 * Deliberately 404 (not 403) so the endpoint is undiscoverable.
 */
export async function requireAdmin(): Promise<AdminOk | AdminFail> {
  const session = await getSession();
  const email = session?.user?.email ?? null;
  if (!email || !isAdminEmail(email)) {
    return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { userId: session!.user.id, email };
}
