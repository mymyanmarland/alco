"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FolderKanban, Pencil, Plus, Trash2, X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import type { ProjectSummary } from "../dashboard/page";

const inputClass =
  "rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

function ProjectRow({
  project,
  onRenamed,
  onDeleted,
}: {
  project: ProjectSummary;
  onRenamed: (p: ProjectSummary) => void;
  onDeleted: (id: string) => void;
}) {
  const { t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveRename(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { project: ProjectSummary };
      onRenamed(data.project);
      setEditing(false);
    } catch {
      setError(t.auth.genericError);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      onDeleted(project.id);
    } catch {
      setError(t.auth.genericError);
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <li className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
          <FolderKanban className="h-5 w-5 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <form onSubmit={saveRename} className="flex flex-col gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className={inputClass}
                aria-label={t.projects.rename}
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
                >
                  {busy ? t.projects.saving : t.projects.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setName(project.name);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  {t.projects.cancel}
                </button>
              </div>
            </form>
          ) : (
            <>
              <Link
                href={`/builder/${project.id}`}
                className="block truncate text-base font-semibold hover:text-primary"
              >
                {project.name}
              </Link>
              <p className="truncate text-sm text-muted-foreground">
                {project.description ?? "—"}
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="mt-1 text-xs text-red-500">
              {error}
            </p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              title={t.projects.rename}
              aria-label={t.projects.rename}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
            {confirmingDelete ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={doDelete}
                  className="rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy ? t.projects.deleting : t.projects.delete}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  aria-label={t.projects.cancel}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingDelete(true)}
                title={t.projects.deleteConfirm}
                aria-label={t.projects.delete}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function ProjectsPage() {
  const { t } = useLocale();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { projects: ProjectSummary[] };
      setProjects(data.projects);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount; no subscription or external store involved
    void load();
  }, [load]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { project: ProjectSummary };
      setProjects((prev) => (prev ? [data.project, ...prev] : [data.project]));
      setName("");
      setDescription("");
      setShowForm(false);
    } catch {
      setFormError(t.auth.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-6">
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            {t.pages.projects.title}
          </h1>
          <p className="mt-1 text-muted-foreground">{t.pages.projects.desc}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t.dashboard.newProject}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={createProject}
          className="flex w-full flex-col gap-4 rounded-2xl border border-border bg-card p-5"
          aria-label={t.projects.newTitle}
        >
          <h2 className="text-base font-semibold">{t.projects.newTitle}</h2>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t.projects.nameLabel}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              placeholder={t.projects.namePlaceholder}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            {t.projects.descLabel}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.projects.descPlaceholder}
              className={inputClass}
            />
          </label>
          {formError && (
            <p role="alert" className="text-sm text-red-500">
              {formError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy ? t.projects.creating : t.projects.create}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-xl border border-border px-4 py-2 text-sm font-medium text-muted-foreground"
            >
              {t.projects.cancel}
            </button>
          </div>
        </form>
      )}

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-red-500">{t.projects.loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-border px-4 py-2 text-sm font-medium"
          >
            {t.projects.retry}
          </button>
        </div>
      ) : projects === null ? (
        <p className="text-sm text-muted-foreground">{t.projects.loading}</p>
      ) : projects.length === 0 ? (
        <div className="flex w-full flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
            <FolderKanban className="h-6 w-6 text-primary" />
          </span>
          <h3 className="text-base font-semibold">{t.projects.emptyTitle}</h3>
          <p className="max-w-md text-sm text-muted-foreground">{t.projects.emptyDesc}</p>
        </div>
      ) : (
        <ul className="grid w-full gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              onRenamed={(updated) =>
                setProjects((prev) =>
                  prev ? prev.map((x) => (x.id === updated.id ? updated : x)) : prev,
                )
              }
              onDeleted={(id) =>
                setProjects((prev) => (prev ? prev.filter((x) => x.id !== id) : prev))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}
