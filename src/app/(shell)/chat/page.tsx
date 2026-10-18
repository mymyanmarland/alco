"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

type ConvSummary = {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
};

type Msg = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
};

type ChatEvent =
  | { type: "chunk"; text: string }
  | {
      type: "done";
      conversationId: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
    }
  | { type: "error"; code: string; message: string };

const inputClass =
  "w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring";

function parseSSE(buffer: string): { events: ChatEvent[]; rest: string } {
  const events: ChatEvent[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const lines = part.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      try {
        events.push(JSON.parse(trimmed.slice(5).trim()) as ChatEvent);
      } catch {
        // ignore malformed event
      }
    }
  }
  return { events, rest };
}

function Markdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p className="my-2 first:mt-0 last:mb-0">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          code: ({ className, children }) =>
            className?.includes("language-") ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[13px]">
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-xl border border-border bg-secondary/60 p-4 font-mono text-[13px] leading-relaxed">
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a
              className="text-primary underline underline-offset-2 hover:opacity-80"
              target="_blank"
              rel="noreferrer"
              href={href}
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-primary/50 pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-secondary/60 px-3 py-1.5 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
          h1: ({ children }) => (
            <h1 className="mb-2 mt-4 text-lg font-bold first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-4 text-base font-bold first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1 mt-3 text-sm font-bold first:mt-0">
              {children}
            </h3>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPage() {
  const { t } = useLocale();
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadConversations = useCallback(async () => {
    setConvError(null);
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { conversations: ConvSummary[] };
      setConversations(data.conversations);
    } catch {
      setConvError(t.chat.loadError);
    } finally {
      setLoadingConvs(false);
    }
  }, [t]);

  const loadModels = useCallback(async () => {
    // BYO: prefer the user's own provider model list; fall back to the
    // server list when there is no key or the provider list fails.
    try {
      const res = await fetch("/api/ai/models");
      if (res.ok) {
        const data = (await res.json()) as { models?: string[] };
        const list = data.models;
        if (Array.isArray(list) && list.length > 0) {
          setModels(list);
          setModel((prev) =>
            prev && list.includes(prev) ? prev : list[0],
          );
          return;
        }
      }
    } catch {
      // fall through to the server list
    }
    try {
      const res = await fetch("/api/chat");
      if (!res.ok) return;
      const data = (await res.json()) as {
        models: string[];
        defaultModel: string;
      };
      setModels(data.models);
      setModel(data.defaultModel);
    } catch {
      // model selector simply stays hidden
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client-side data load on mount; this page is client-only so there is no hydration mismatch
    loadConversations();
    loadModels();
  }, [loadConversations, loadModels]);

  // Auto-scroll while streaming, but respect manual scroll-up.
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, streamText, streaming]);

  function handleThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  async function selectConversation(id: string) {
    if (streaming) stopStream();
    setActiveId(id);
    setMessages([]);
    setError(null);
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/conversations/${id}/messages`);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { messages: Msg[] };
      setMessages(data.messages);
      stickRef.current = true;
    } catch {
      setError(t.chat.messagesError);
    } finally {
      setLoadingMsgs(false);
    }
  }

  function newChat() {
    if (streaming) stopStream();
    setActiveId(null);
    setMessages([]);
    setStreamText("");
    setError(null);
    stickRef.current = true;
    inputRef.current?.focus();
  }

  async function send(retry = false) {
    if (streaming) return;
    const text = input.trim();
    if (!retry && !text) return;

    setError(null);
    setStreaming(true);
    setStreamText("");
    stickRef.current = true;

    // Optimistic user message (not for retry — it's already persisted).
    const tempUserId = `tmp-user-${Date.now()}`;
    if (!retry) {
      setMessages((prev) => [
        ...prev,
        {
          id: tempUserId,
          role: "user",
          content: text,
          createdAt: new Date().toISOString(),
        },
      ]);
      setInput("");
    }

    const controller = new AbortController();
    abortRef.current = controller;
    let convId = activeId;
    let acc = "";
    let failed = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeId,
          message: retry ? undefined : text,
          model: model || undefined,
          retry,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parsed = parseSSE(buf);
        buf = parsed.rest;
        for (const ev of parsed.events) {
          if (ev.type === "chunk") {
            acc += ev.text;
            setStreamText(acc);
          } else if (ev.type === "done") {
            convId = ev.conversationId;
          } else if (ev.type === "error") {
            failed = true;
            setError(ev.message);
          }
        }
        if (failed) break;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // stopped by the user — keep what streamed so far
      } else {
        failed = true;
        setError(t.chat.sendError);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      if (failed) {
        // Drop the optimistic user bubble on hard failure so retry is clean.
        // (The server only persisted it when the stream actually started.)
        setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
        setStreamText("");
      } else {
        // Replace optimistic ids with a refresh of the authoritative thread.
        if (convId) {
          setActiveId(convId);
          try {
            const res = await fetch(`/api/conversations/${convId}/messages`);
            if (res.ok) {
              const data = (await res.json()) as { messages: Msg[] };
              setMessages(data.messages);
            }
          } catch {
            // thread stays as streamed; list refresh below still runs
          }
          loadConversations();
        }
        setStreamText("");
      }
    }
  }

  async function deleteConversation(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(String(res.status));
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
      }
    } catch {
      setConvError(t.chat.loadError);
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:h-[calc(100dvh-7rem)] lg:min-h-[560px] lg:flex-row">
        {/* Conversation list */}
        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:w-72">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold">
              {t.chat.conversations}
            </span>
            <button
              type="button"
              onClick={newChat}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              {t.chat.newChat}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto p-2 lg:max-h-none lg:flex-1">
            {loadingConvs ? (
              <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : convError ? (
              <div className="p-4 text-center">
                <p className="text-sm text-muted-foreground">{convError}</p>
                <button
                  type="button"
                  onClick={loadConversations}
                  className="mt-2 text-sm font-medium text-primary hover:opacity-80"
                >
                  {t.projects.retry}
                </button>
              </div>
            ) : conversations.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t.chat.noConversations}
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <div
                      className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        activeId === c.id
                          ? "bg-primary/15"
                          : "hover:bg-secondary"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => selectConversation(c.id)}
                        className="flex min-w-0 flex-1 items-center gap-2"
                      >
                        <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate text-sm font-medium">
                          {c.title || t.chat.newConversation}
                        </span>
                      </button>
                      {confirmDeleteId === c.id ? (
                        <button
                          type="button"
                          disabled={deletingId === c.id}
                          onClick={() => deleteConversation(c.id)}
                          className="shrink-0 rounded-lg bg-destructive/15 px-2 py-1 text-xs font-semibold text-destructive hover:bg-destructive/25 disabled:opacity-50"
                        >
                          {deletingId === c.id ? t.chat.deleting : "OK"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(c.id)}
                          className="shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover:opacity-100"
                          aria-label={t.chat.delete}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Thread */}
        <section className="flex min-h-[70dvh] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card lg:min-h-0">
          <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
            <span className="truncate text-sm font-semibold">
              {activeId
                ? (conversations.find((c) => c.id === activeId)?.title ||
                  t.chat.newConversation)
                : t.chat.newConversation}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <label
                htmlFor="model-select"
                className="hidden text-xs text-muted-foreground sm:inline"
              >
                {t.chat.model}
              </label>
              {models.length > 0 && (
                <select
                  id="model-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={streaming}
                  className="max-w-44 truncate rounded-xl border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring disabled:opacity-50"
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div
            ref={threadRef}
            onScroll={handleThreadScroll}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6"
          >
            {loadingMsgs ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : messages.length === 0 && !streaming && !streamText ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15">
                  <MessageSquare className="h-6 w-6 text-primary" />
                </span>
                <h2 className="text-base font-semibold">{t.chat.emptyTitle}</h2>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {t.chat.emptyDesc}
                </p>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                {messages.map((m) =>
                  m.role === "user" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                        {m.content}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex justify-start">
                      <div className="max-w-full flex-1 rounded-2xl rounded-bl-md border border-border bg-secondary/40 px-4 py-3">
                        <Markdown content={m.content} />
                      </div>
                    </div>
                  ),
                )}
                {(streaming || streamText) && (
                  <div className="flex justify-start">
                    <div className="max-w-full flex-1 rounded-2xl rounded-bl-md border border-border bg-secondary/40 px-4 py-3">
                      {streamText ? (
                        <Markdown content={streamText} />
                      ) : (
                        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t.chat.streaming}
                        </span>
                      )}
                      <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-primary align-middle" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 md:mx-6">
              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
              <p className="min-w-0 flex-1 text-sm">{error}</p>
              <button
                type="button"
                onClick={() => send(true)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-destructive/15 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/25"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.chat.retry}
              </button>
            </div>
          )}

          <div className="border-t border-border px-4 py-3 md:px-6">
            <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={2}
                maxLength={8000}
                placeholder={t.chat.inputPlaceholder}
                disabled={streaming}
                className={inputClass}
                aria-label={t.chat.newConversation}
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stopStream}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive transition-colors hover:bg-destructive/25"
                  aria-label={t.chat.stop}
                  title={t.chat.stop}
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send(false)}
                  disabled={!input.trim()}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40"
                  aria-label={t.chat.send}
                  title={t.chat.send}
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
