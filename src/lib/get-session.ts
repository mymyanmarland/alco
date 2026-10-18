import { headers } from "next/headers";
import { auth } from "./auth";

/** Server-side session lookup. Returns null when signed out. */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/** Server-side guard: returns the session or null. Ownership checks in
 *  queries always use session.user.id (app-level, no Postgres RLS in M2). */
export async function requireUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.user?.id ?? null;
}
