"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Loader2, TerminalSquare, X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

interface RunSummary {
  id: string;
  projectId: string | null;
  project: { name: string } | null;
  runtime: string;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  driver: string | null;
  snapshotRef: string | null;
  createdAt: string;
}

interface RunDetail extends RunSummary {
  stdout: string | null;
  stderr: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  succeeded: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
  timeout: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  running: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  queued: "bg-muted text-muted-foreground border-border",
};

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export default function SandboxPage() {
  const { t } = useLocale();
  const s = t.sandboxPage;
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/runs?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRuns(data.runs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : s.loadError);
    } finally {
      setLoading(false);
    }
  }, [s.loadError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client-side data load on mount; this page is client-only so there is no hydration mismatch
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      try {
        const res = await fetch(`/api/sandbox/runs/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setDetail(data.run);
      } catch (err) {
        setDetail(null);
        setError(err instanceof Error ? err.message : s.loadError);
      } finally {
        setDetailLoading(false);
      }
    },
    [s.loadError],
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <TerminalSquare className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">{t.pages.sandbox.title}</h1>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* History list */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <History className="h-4 w-4" />
            {s.historyTitle}
          </h2>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {s.loading}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.empty}</p>
          ) : (
            <ul className="space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <button
                    onClick={() => void openDetail(r.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-secondary ${
                      selectedId === r.id ? "border-primary/50" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">
                        {r.project?.name ?? s.unknownProject}
                      </span>
                      <span
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? STATUS_STYLE.queued}`}
                      >
                        {s.status[r.status as keyof typeof s.status] ?? r.status}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{new Date(r.createdAt).toLocaleString()}</span>
                      <span>{formatDuration(r.durationMs)}</span>
                      <span className="font-mono">{r.driver ?? "—"}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Log viewer */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">{s.logsTitle}</h2>
            {selectedId && (
              <button
                onClick={() => {
                  setSelectedId(null);
                  setDetail(null);
                }}
                className="rounded-lg p-1 hover:bg-secondary"
                aria-label={s.close}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {!selectedId ? (
            <p className="text-sm text-muted-foreground">{s.selectPrompt}</p>
          ) : detailLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {s.loading}
            </div>
          ) : detail ? (
            <div className="space-y-3">
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{detail.id}</span>
                {" · "}
                {detail.snapshotRef ? (
                  <span className="font-mono">
                    {detail.snapshotRef.slice(0, 7)}
                  </span>
                ) : (
                  "—"
                )}
              </div>
              {detail.stdout ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    stdout
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-background p-3 font-mono text-xs whitespace-pre-wrap">
                    {detail.stdout}
                  </pre>
                </div>
              ) : null}
              {detail.stderr ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    stderr
                  </p>
                  <pre className="max-h-64 overflow-auto rounded-xl bg-background p-3 font-mono text-xs whitespace-pre-wrap text-red-300">
                    {detail.stderr}
                  </pre>
                </div>
              ) : null}
              {!detail.stdout && !detail.stderr && (
                <p className="text-sm text-muted-foreground">{s.noLogs}</p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
