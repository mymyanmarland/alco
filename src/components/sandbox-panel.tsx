"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Play, SquareTerminal, X } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

type SandboxEvent =
  | { type: "run"; runId: string; sha: string; projectType: string; driver: string }
  | { type: "step"; step: string; status: "started" | "done"; exitCode?: number; timedOut?: boolean; durationMs?: number }
  | { type: "log"; step: string; stream: "stdout" | "stderr"; text: string }
  | { type: "done"; status: "succeeded" | "failed" | "timeout"; durationMs: number; previewUrl?: string; previewExpiresAt?: number }
  | { type: "error"; code: string; message: string };

interface LogLine {
  id: number;
  text: string;
  kind: "info" | "ok" | "error" | "out" | "err";
}

let logId = 0;
const nextLogId = () => ++logId;

export default function SandboxPanel({ projectId }: { projectId: string }) {
  const { t } = useLocale();
  const s = t.sandboxPage;
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const push = useCallback((text: string, kind: LogLine["kind"]) => {
    setLogs((prev) => [...prev.slice(-400), { id: nextLogId(), text, kind }]);
  }, []);

  const run = useCallback(async () => {
    if (running) return;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setOpen(true);
    setRunning(true);
    setLogs([]);
    setPreviewUrl(null);
    setFinalStatus(null);
    push(s.starting, "info");
    try {
      const res = await fetch("/api/sandbox/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        push(`${s.failed}: ${data.error ?? `HTTP ${res.status}`}`, "error");
        setRunning(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            let e: SandboxEvent;
            try {
              e = JSON.parse(trimmed.slice(5).trim()) as SandboxEvent;
            } catch {
              continue;
            }
            if (e.type === "run") {
              push(`${s.runStarted} · ${e.projectType} · ${e.driver}`, "info");
            } else if (e.type === "step") {
              if (e.status === "started") push(`▶ ${e.step}…`, "info");
              else
                push(
                  `${e.timedOut ? "⏱" : e.exitCode === 0 ? "✓" : "✗"} ${e.step} (exit ${e.exitCode ?? "?"})`,
                  e.exitCode === 0 && !e.timedOut ? "ok" : "error",
                );
            } else if (e.type === "log") {
              const lines = e.text.split("\n");
              for (const l of lines) {
                const t2 = l.length > 500 ? l.slice(0, 500) + "…" : l;
                if (t2.trim()) push(t2, e.stream === "stderr" ? "err" : "out");
              }
            } else if (e.type === "done") {
              setFinalStatus(e.status);
              push(
                `${s.finished}: ${s.status[e.status as keyof typeof s.status] ?? e.status} (${(e.durationMs / 1000).toFixed(1)}s)`,
                e.status === "succeeded" ? "ok" : "error",
              );
              if (e.previewUrl) {
                setPreviewUrl(e.previewUrl);
                push(`${s.previewReady}: ${e.previewUrl}`, "ok");
              }
            } else if (e.type === "error") {
              push(`${s.failed}: [${e.code}] ${e.message}`, "error");
            }
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        push(`${s.failed}: ${(err as Error).message}`, "error");
      }
    } finally {
      setRunning(false);
    }
  }, [projectId, push, running, s]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  return (
    <div className="rounded-2xl border border-border bg-card">
      <button
        onClick={() => (open ? setOpen(false) : void run())}
        disabled={running}
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold"
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Play className="h-4 w-4 text-primary" />
        )}
        {running ? s.running : s.runButton}
        {finalStatus && !running && (
          <span className="ml-auto text-xs text-muted-foreground">
            {s.status[finalStatus as keyof typeof s.status] ?? finalStatus}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <SquareTerminal className="h-4 w-4" />
              {s.logsTitle}
            </span>
            <button
              onClick={() => setOpen(false)}
              className="rounded-lg p-1 hover:bg-secondary"
              aria-label={s.close}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-72 overflow-auto rounded-xl bg-background p-3 font-mono text-xs">
            {logs.length === 0 ? (
              <span className="text-muted-foreground">{s.waiting}</span>
            ) : (
              logs.map((l) => (
                <div
                  key={l.id}
                  className={
                    l.kind === "error" || l.kind === "err"
                      ? "text-red-300"
                      : l.kind === "ok"
                        ? "text-emerald-300"
                        : l.kind === "info"
                          ? "text-sky-300"
                          : "text-foreground/90"
                  }
                >
                  {l.text}
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              <ExternalLink className="h-4 w-4" />
              {s.openPreview}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
