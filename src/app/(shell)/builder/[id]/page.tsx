"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Editor from "@monaco-editor/react";
import {
  FileCode2,
  GitBranch,
  Hammer,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { useTheme } from "@/components/theme-provider";
import SandboxPanel from "@/components/sandbox-panel";

/* ── Types ─────────────────────────────────────────────── */

interface PlanFile {
  path: string;
  purpose: string;
}
interface BuildPlan {
  features: string[];
  files: PlanFile[];
  tasks: string[];
}
interface RepoFile {
  path: string;
  sizeBytes: number;
}
interface RepoVersion {
  sha: string;
  message: string;
  date: string;
}
type BuilderEvent =
  | { type: "plan"; plan: BuildPlan }
  | {
      type: "file";
      path: string;
      status: "started" | "done" | "error";
      message?: string;
      bytes?: number;
    }
  | {
      type: "done";
      commitSha?: string | null;
      files?: { path: string; bytes: number }[];
    }
  | { type: "error"; code: string; message: string };

interface LogLine {
  id: number;
  text: string;
  kind: "info" | "ok" | "error";
}

type BusyKind = "plan" | "generate" | "edit" | "rollback" | null;

/* ── Helpers ───────────────────────────────────────────── */

function parseSSE(buffer: string): { events: BuilderEvent[]; rest: string } {
  const events: BuilderEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    for (const line of part.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(trimmed.slice(5).trim()) as BuilderEvent);
      } catch {
        // ignore malformed event
      }
    }
  }
  return { events, rest };
}

async function* streamEvents(
  response: Response,
): AsyncGenerator<BuilderEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseSSE(buffer);
    buffer = rest;
    for (const e of events) yield e;
  }
}

function languageForPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "html":
      return "html";
    case "css":
      return "css";
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "svg":
    case "xml":
      return "xml";
    case "yml":
    case "yaml":
      return "yaml";
    case "toml":
      return "ini";
    default:
      return "plaintext";
  }
}

const inputClass =
  "w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";
const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const btnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";

/* ── Workspace ─────────────────────────────────────────── */

function BuilderWorkspace() {
  const { t } = useLocale();
  const { theme } = useTheme();
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const w = t.workspace;

  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<RepoFile[]>([]);
  const [versions, setVersions] = useState<RepoVersion[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [contents, setContents] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [plan, setPlan] = useState<BuildPlan | null>(null);
  const [instruction, setInstruction] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState<BusyKind>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryKind, setRetryKind] = useState<
    null | "plan" | "generate" | "edit"
  >(null);
  const logId = useRef(0);

  const pushLog = useCallback((text: string, kind: LogLine["kind"]) => {
    logId.current += 1;
    const id = logId.current;
    setLog((prev) => [...prev.slice(-99), { id, text, kind }]);
  }, []);

  const fail = useCallback(
    (message: string, kind: "plan" | "generate" | "edit" | null) => {
      setError(message);
      setRetryKind(kind);
      pushLog(message, "error");
    },
    [pushLog],
  );

  const refresh = useCallback(async () => {
    try {
      const [vRes, fRes] = await Promise.all([
        fetch(`/api/builder/${projectId}/versions`),
        fetch(`/api/builder/${projectId}/files`),
      ]);
      if (vRes.ok) {
        const data = (await vRes.json()) as {
          project: { name: string };
          versions: RepoVersion[];
        };
        setProjectName(data.project.name);
        setVersions(data.versions);
      }
      if (fRes.ok) {
        const data = (await fRes.json()) as { files: RepoFile[] };
        setFiles(data.files);
      }
    } catch {
      // non-fatal; the error banner handles action failures
    }
  }, [projectId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount; no subscription or external store involved
    void refresh();
  }, [refresh]);

  const openFile = useCallback(
    async (path: string) => {
      setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
      setActiveTab(path);
      if (contents[path] !== undefined) return;
      try {
        const res = await fetch(
          `/api/builder/${projectId}/files?path=${encodeURIComponent(path)}`,
        );
        if (!res.ok) throw new Error("load failed");
        const data = (await res.json()) as { content: string };
        setContents((prev) => ({ ...prev, [path]: data.content }));
      } catch {
        setContents((prev) => ({ ...prev, [path]: "// could not load file" }));
      }
    },
    [projectId, contents],
  );

  const closeTab = useCallback(
    (path: string) => {
      const next = openTabs.filter((p) => p !== path);
      setOpenTabs(next);
      if (activeTab === path) {
        setActiveTab(next.slice(-1)[0] ?? null);
      }
    },
    [openTabs, activeTab],
  );

  const runPlan = useCallback(async () => {
    if (busy || !prompt.trim()) return;
    setBusy("plan");
    setError(null);
    setPlan(null);
    pushLog(w.planning, "info");
    try {
      const res = await fetch("/api/builder/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, prompt: prompt.trim() }),
      });
      if (!res.ok && !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      for await (const e of streamEvents(res)) {
        if (e.type === "plan") {
          setPlan(e.plan);
          pushLog(`Plan ready: ${e.plan.files.length} files`, "ok");
        } else if (e.type === "error") {
          throw new Error(e.message);
        }
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : w.errorTitle, "plan");
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, prompt, projectId]);

  const runGenerate = useCallback(async () => {
    if (busy || !plan) return;
    setBusy("generate");
    setError(null);
    pushLog(w.generating, "info");
    try {
      const res = await fetch("/api/builder/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          plan,
          prompt: prompt.trim() || undefined,
        }),
      });
      if (!res.ok && !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      for await (const e of streamEvents(res)) {
        if (e.type === "file") {
          if (e.status === "done") {
            pushLog(`${e.path} ✓ (${e.bytes ?? 0} bytes)`, "ok");
          } else if (e.status === "error") {
            pushLog(`${e.path}: ${e.message ?? "failed"}`, "error");
          }
        } else if (e.type === "done") {
          pushLog(
            `Committed ${e.commitSha ? e.commitSha.slice(0, 7) : "(no changes)"}`,
            "ok",
          );
          setContents({});
          setOpenTabs([]);
          setActiveTab(null);
          await refresh();
          const first = e.files?.[0]?.path;
          if (first) void openFile(first);
        } else if (e.type === "error") {
          throw new Error(e.message);
        }
      }
    } catch (err) {
      fail(err instanceof Error ? err.message : w.errorTitle, "generate");
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, plan, projectId, prompt]);

  const runEdit = useCallback(async () => {
    if (busy || !instruction.trim()) return;
    setBusy("edit");
    setError(null);
    pushLog(w.editTitle, "info");
    try {
      const res = await fetch("/api/builder/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          instruction: instruction.trim(),
        }),
      });
      if (!res.ok && !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      for await (const e of streamEvents(res)) {
        if (e.type === "file" && e.status === "done") {
          pushLog(`${e.path} ✓`, "ok");
          setContents((prev) => {
            const next = { ...prev };
            delete next[e.path];
            return next;
          });
        } else if (e.type === "error") {
          throw new Error(e.message);
        }
      }
      setInstruction("");
      await refresh();
      if (activeTab) void openFile(activeTab);
    } catch (err) {
      fail(err instanceof Error ? err.message : w.errorTitle, "edit");
    } finally {
      setBusy(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, instruction, projectId, activeTab]);

  const runRollback = useCallback(
    async (sha: string) => {
      if (busy) return;
      if (!window.confirm(w.rollbackConfirm)) return;
      setBusy("rollback");
      setError(null);
      try {
        const res = await fetch(`/api/builder/${projectId}/rollback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sha }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Rollback failed");
        pushLog("Rolled back — new commit created", "ok");
        setContents({});
        await refresh();
        if (activeTab) void openFile(activeTab);
      } catch (err) {
        fail(err instanceof Error ? err.message : w.errorTitle, null);
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, projectId, activeTab],
  );

  const retryLast = useCallback(() => {
    const kind = retryKind;
    setRetryKind(null);
    setError(null);
    if (kind === "plan") void runPlan();
    else if (kind === "generate") void runGenerate();
    else if (kind === "edit") void runEdit();
  }, [retryKind, runPlan, runGenerate, runEdit]);

  const spinner = (label: string) => (
    <span className="inline-flex items-center gap-2">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  );

  return (
    <div className="flex h-full flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Hammer className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-bold">
          {t.pages.builder.title}
          {projectName ? ` · ${projectName}` : ""}
        </h1>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <span>
            <strong>{w.errorTitle}:</strong> {error}
          </span>
          {retryKind && (
            <button className={btnGhost} onClick={retryLast}>
              {w.retry}
            </button>
          )}
        </div>
      )}

      <div className="grid flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)_280px]">
        {/* ── Left: prompt / plan / progress / edit ── */}
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <textarea
              className={inputClass}
              rows={3}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={w.promptPlaceholder}
              disabled={busy !== null}
            />
            <button
              className={`${btnPrimary} mt-3 w-full`}
              onClick={() => void runPlan()}
              disabled={busy !== null || !prompt.trim()}
            >
              {busy === "plan" ? (
                spinner(w.planning)
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  {w.planButton}
                </>
              )}
            </button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{w.planTitle}</h2>
            {!plan ? (
              <p className="text-sm text-muted-foreground">{w.planEmpty}</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">
                    {w.features}
                  </p>
                  <ul className="list-disc pl-5">
                    {plan.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">{w.files}</p>
                  <ul className="list-disc pl-5 font-mono text-[13px]">
                    {plan.files.map((f) => (
                      <li key={f.path}>
                        {f.path}{" "}
                        <span className="text-muted-foreground">
                          — {f.purpose}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                {plan.tasks.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground">
                      {w.tasks}
                    </p>
                    <ol className="list-decimal pl-5">
                      {plan.tasks.map((task) => (
                        <li key={task}>{task}</li>
                      ))}
                    </ol>
                  </div>
                )}
                <button
                  className={`${btnPrimary} w-full`}
                  onClick={() => void runGenerate()}
                  disabled={busy !== null}
                >
                  {busy === "generate" ? (
                    spinner(w.generating)
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      {w.generateButton}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{w.editTitle}</h2>
            <textarea
              className={inputClass}
              rows={2}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={w.editPlaceholder}
              disabled={busy !== null}
            />
            <button
              className={`${btnGhost} mt-3 w-full`}
              onClick={() => void runEdit()}
              disabled={busy !== null || !instruction.trim()}
            >
              {busy === "edit" ? (
                spinner(w.generating)
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {w.editButton}
                </>
              )}
            </button>
          </div>

          <div className="min-h-24 flex-1 rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{w.progressTitle}</h2>
            <div className="max-h-48 space-y-1 overflow-y-auto font-mono text-xs">
              {log.map((l) => (
                <p
                  key={l.id}
                  className={
                    l.kind === "error"
                      ? "text-destructive"
                      : l.kind === "ok"
                        ? "text-emerald-500"
                        : "text-muted-foreground"
                  }
                >
                  {l.text}
                </p>
              ))}
            </div>
          </div>

          <SandboxPanel projectId={projectId} />
        </div>

        {/* ── Center: explorer + editor ── */}
        <div className="flex min-h-[420px] flex-col gap-4">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{w.filesTitle}</h2>
            {files.length === 0 ? (
              <p className="text-sm text-muted-foreground">{w.noFiles}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {files.map((f) => (
                  <button
                    key={f.path}
                    onClick={() => void openFile(f.path)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs transition-colors hover:bg-secondary ${
                      activeTab === f.path
                        ? "border-primary bg-primary/10"
                        : "border-border"
                    }`}
                  >
                    <FileCode2 className="h-3.5 w-3.5" />
                    {f.path}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card">
            {openTabs.length > 0 && (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2">
                {openTabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`group inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 font-mono text-xs ${
                      activeTab === tab
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {tab.split("/").pop()}
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Close tab"
                      className="rounded p-0.5 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          closeTab(tab);
                        }
                      }}
                    >
                      <X className="h-3 w-3" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-[320px] flex-1">
              {activeTab ? (
                <Editor
                  height="100%"
                  language={languageForPath(activeTab)}
                  value={contents[activeTab] ?? "// loading…"}
                  theme={theme === "dark" ? "vs-dark" : "light"}
                  options={{
                    readOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    scrollBeyondLastLine: false,
                    padding: { top: 12 },
                  }}
                  loading={
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  }
                />
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center p-8 text-center text-sm text-muted-foreground">
                  {w.noFiles}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: versions ── */}
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4" />
            {w.versionsTitle}
          </h2>
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{w.noFiles}</p>
          ) : (
            <ol className="space-y-3">
              {versions.map((v) => (
                <li
                  key={v.sha}
                  className="rounded-xl border border-border p-3 text-sm"
                >
                  <p className="font-mono text-xs text-primary">
                    {v.sha.slice(0, 7)}
                  </p>
                  <p className="mt-1 line-clamp-2">{v.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(v.date).toLocaleString()}
                  </p>
                  <button
                    className={`${btnGhost} mt-2 w-full !py-1.5 text-xs`}
                    onClick={() => void runRollback(v.sha)}
                    disabled={busy !== null}
                  >
                    {busy === "rollback" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {w.rollback}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BuilderDetailPage() {
  return (
    <Suspense>
      <BuilderWorkspace />
    </Suspense>
  );
}
