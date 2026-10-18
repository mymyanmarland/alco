"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FolderKanban, LayoutDashboard, Plus } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export default function DashboardPage() {
  const { t } = useLocale();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/projects");
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { projects: ProjectSummary[] };
        if (!cancelled) setProjects(data.projects);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col items-start gap-6">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {t.pages.dashboard.title}
          </h1>
          <p className="mt-1 text-muted-foreground">{t.pages.dashboard.desc}</p>
        </div>
        <Link
          href="/projects"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t.dashboard.newProject}
        </Link>
      </div>

      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15">
          <LayoutDashboard className="h-5 w-5 text-primary" />
        </span>
        <div>
          <div className="text-2xl font-bold">{projects?.length ?? "…"}</div>
          <div className="text-xs text-muted-foreground">
            {t.dashboard.projectsTitle} · {t.dashboard.projectCount}
          </div>
        </div>
      </div>

      <section className="w-full">
        <h2 className="mb-3 text-lg font-semibold">{t.dashboard.projectsTitle}</h2>
        {error ? (
          <p className="text-sm text-red-500">{t.projects.loadError}</p>
        ) : projects === null ? (
          <p className="text-sm text-muted-foreground">{t.projects.loading}</p>
        ) : projects.length === 0 ? (
          <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
              <FolderKanban className="h-6 w-6 text-primary" />
            </span>
            <h3 className="text-base font-semibold">{t.dashboard.emptyTitle}</h3>
            <p className="max-w-md text-sm text-muted-foreground">{t.dashboard.emptyDesc}</p>
            <Link
              href="/projects"
              className="mt-2 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              {t.dashboard.newProject}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/builder/${p.id}`}
                  className="block rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                      <FolderKanban className="h-5 w-5 text-primary" />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-semibold">{p.name}</h3>
                      <p className="truncate text-sm text-muted-foreground">
                        {p.description ?? "—"}
                      </p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t.dashboard.updatedAt}: {formatDate(p.updatedAt)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
