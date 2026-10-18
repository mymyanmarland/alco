"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { useLocale } from "@/i18n/locale-provider";
import { LocaleToggle, Logo, ThemeToggle } from "@/components/app-shell";

const inputClass =
  "rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

export default function SignupPage() {
  const { t } = useLocale();
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isPending && session?.user) {
      router.replace("/dashboard");
    }
  }, [isPending, session, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: signUpError } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (signUpError) {
      setError(signUpError.message ?? t.auth.genericError);
      return;
    }
    router.push("/dashboard");
    router.refresh();
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
              <h1 className="text-xl font-bold tracking-tight">{t.signup.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{t.signup.subtitle}</p>
            </div>
          </div>

          <form className="flex flex-col gap-4" onSubmit={onSubmit} aria-label={t.signup.title}>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t.signup.name}
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t.signup.email}
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
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              {t.signup.password}
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
              {busy ? t.signup.signingUp : t.signup.submit}
            </button>
          </form>

          <div className="mt-6 flex flex-col items-center gap-2 text-sm">
            <Link href="/login" className="font-medium text-primary hover:underline">
              {t.signup.signinCta}
            </Link>
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              {t.signup.backHome}
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
