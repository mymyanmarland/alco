import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/get-session";

// Session lookup uses request headers(). In Next 16's Cache Components mode
// that must happen inside a Suspense boundary so the shell can stream.
async function ShellGuard({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email }}>
      {children}
    </AppShell>
  );
}

export default function ShellLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <ShellGuard>{children}</ShellGuard>
    </Suspense>
  );
}
