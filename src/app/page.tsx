"use client";

import Link from "next/link";
import { ArrowRight, Box, Languages, Sparkles } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { LocaleToggle, Logo, ThemeToggle } from "@/components/app-shell";

const FEATURES = [
  { icon: Sparkles, titleKey: "feature1Title", descKey: "feature1Desc" },
  { icon: Box, titleKey: "feature2Title", descKey: "feature2Desc" },
  { icon: Languages, titleKey: "feature3Title", descKey: "feature3Desc" },
] as const;

export default function LandingPage() {
  const { t } = useLocale();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top nav */}
      <header className="flex h-16 items-center gap-3 border-b border-border px-4 md:px-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="ALCO home">
          <Logo size={32} />
          <span className="text-base font-bold tracking-tight">{t.brand.name}</span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />
          <Link
            href="/login"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            {t.shell.signIn}
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center px-4 py-16 text-center md:py-24">
        <span className="mb-8 inline-flex items-center justify-center rounded-3xl bg-white p-3 shadow-lg shadow-primary/20">
          <Logo size={96} />
        </span>

        <span className="mb-4 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {t.landing.badge}
        </span>

        <h1 className="max-w-3xl text-4xl font-extrabold tracking-tight md:text-6xl">
          {t.landing.titleA}
          <span className="mt-2 block bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            {t.landing.titleB}
          </span>
        </h1>

        <p className="mt-4 text-lg font-medium text-muted-foreground md:text-xl">
          {t.landing.tagline}
        </p>

        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground">
          {t.landing.description}
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
          >
            {t.landing.ctaPrimary}
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-xl border border-border bg-card px-6 py-3 text-sm font-semibold transition-colors hover:bg-secondary"
          >
            {t.landing.ctaSecondary}
          </Link>
        </div>

        {/* Feature cards */}
        <div className="mt-20 grid w-full max-w-5xl gap-4 text-left md:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.titleKey}
                className="rounded-2xl border border-border bg-card p-6 transition-colors"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15">
                  <Icon className="h-5 w-5 text-primary" />
                </span>
                <h3 className="mt-4 text-base font-semibold">
                  {t.landing[f.titleKey]}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {t.landing[f.descKey]}
                </p>
              </div>
            );
          })}
        </div>
      </main>

      <footer className="border-t border-border px-4 py-6 text-center text-xs text-muted-foreground">
        {t.landing.footer}
      </footer>
    </div>
  );
}
