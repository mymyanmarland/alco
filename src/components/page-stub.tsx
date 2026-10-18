"use client";

import type { LucideIcon } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

export function PageStub({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col items-start gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{title}</h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      <div className="flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-card p-10 text-center md:p-16">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/15">
          <Icon className="h-7 w-7 text-primary" />
        </span>
        <div className="flex flex-col items-center gap-2">
          <span className="rounded-full border border-border bg-secondary px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t.stub.badge}
          </span>
          <p className="max-w-md text-sm text-muted-foreground">{t.stub.note}</p>
        </div>
      </div>
    </div>
  );
}
