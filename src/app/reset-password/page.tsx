"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/i18n/locale-provider";
import { LocaleToggle, Logo, ThemeToggle } from "@/components/app-shell";

const inputClass =
  "rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

function ResetPasswordForm() {
  const { t } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setBusy(false);
    if (resetError) {
      setError(resetError.message ?? t.auth.genericError);
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2500);
  }

  if (!token) {
    return <p className="text-sm text-muted-foreground">{t.reset.noToken}</p>;
  }

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-500" />
        <h2 className="text-base font-semibold">{t.reset.successTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.reset.successDesc}</p>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={onSubmit} aria-label={t.reset.title}>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        {t.reset.newPassword}
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t.reset.resetting : t.reset.submit}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-16 items-center gap-3 border-b border-border px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="ALCO home">
          <Logo size={32} />
          <span className="text-base font-bold tracking-tight">{t.brand.name}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <Logo size={56} />
            <div>
              <h1 className="text-xl font-bold tracking-tight">{t.reset.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.reset.subtitle}</p>
            </div>
          </div>

          <Suspense>
            <ResetPasswordForm />
          </Suspense>

          <div className="mt-6 flex flex-col items-center gap-2 text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              {t.reset.backToLogin}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
