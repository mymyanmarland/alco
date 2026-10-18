"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/i18n/locale-provider";
import { LocaleToggle, Logo, ThemeToggle } from "@/components/app-shell";

const inputClass =
  "rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

export default function ForgotPasswordPage() {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: reqError } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo: "/reset-password",
    });
    setBusy(false);
    if (reqError) {
      setError(reqError.message ?? t.auth.genericError);
      return;
    }
    setSent(true);
  }

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
              <h1 className="text-xl font-bold tracking-tight">{t.forgot.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.forgot.subtitle}</p>
            </div>
          </div>

          {sent ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <h2 className="text-base font-semibold">{t.forgot.sentTitle}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t.forgot.sentDesc}
              </p>
            </div>
          ) : (
            <form
              className="flex flex-col gap-4"
              onSubmit={onSubmit}
              aria-label={t.forgot.title}
            >
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                {t.forgot.email}
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
                {busy ? t.forgot.sending : t.forgot.submit}
              </button>
            </form>
          )}

          <div className="mt-6 flex flex-col items-center gap-2 text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              {t.forgot.backToLogin}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
