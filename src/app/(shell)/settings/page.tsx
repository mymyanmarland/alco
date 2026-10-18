"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, User as UserIcon } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { authClient } from "@/lib/auth-client";

interface KeyStatus {
  configured: boolean;
  provider?: string;
  keyHint?: string;
  baseUrl?: string | null;
  createdAt?: string;
}

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

export default function SettingsPage() {
  const { t } = useLocale();
  const s = t.settingsPage;
  const { data: session } = authClient.useSession();

  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState("");
  const [baseUrlInput, setBaseUrlInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/settings/api-key");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json());
    } catch {
      setLoadError(s.loadError);
    } finally {
      setLoading(false);
    }
  }, [s.loadError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client-side data load on mount; client-only page
    load();
  }, [load]);

  async function saveKey() {
    const key = keyInput.trim();
    if (key.length < 20) {
      setNotice({ ok: false, text: s.keyTooShort });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          baseUrl: baseUrlInput.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          (data && (data.message || data.error)) || `HTTP ${res.status}`,
        );
      }
      setStatus(await res.json());
      // Clear the secret from memory immediately; never echo it back.
      setKeyInput("");
      setBaseUrlInput("");
      setNotice({ ok: true, text: s.saveSuccess });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : s.saveError,
      });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ai/models");
      const data = (await res.json().catch(() => null)) as {
        models?: string[];
        message?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        throw new Error(
          (data && (data.message || data.error)) || `HTTP ${res.status}`,
        );
      }
      const n = Array.isArray(data?.models) ? data.models.length : 0;
      setNotice({ ok: true, text: s.testSuccess.replace("{n}", String(n)) });
    } catch (err) {
      setNotice({
        ok: false,
        text: err instanceof Error ? err.message : s.testError,
      });
    } finally {
      setTesting(false);
    }
  }

  async function removeKey() {
    if (!window.confirm(s.removeConfirm)) return;
    setRemoving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/settings/api-key", { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus({ configured: false });
      setNotice({ ok: true, text: s.removeSuccess });
    } catch {
      setNotice({ ok: false, text: s.removeError });
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5 p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{s.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.pages.settings.desc}
        </p>
      </div>

      <Card title={s.profile} icon={<UserIcon className="h-4 w-4" />}>
        <div className="flex flex-col gap-3">
          <Field label={s.name} value={session?.user?.name || "—"} />
          <Field label={s.email} value={session?.user?.email || "—"} />
        </div>
      </Card>

      <Card title={s.apiKey} icon={<KeyRound className="h-4 w-4" />}>
        <p className="mb-4 text-sm text-muted-foreground">{s.apiKeyDesc}</p>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : loadError ? (
          <p className="text-sm text-red-400">{loadError}</p>
        ) : status?.configured ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label={s.provider} value={status.provider || "—"} />
              <Field
                label={s.keyLabel}
                value={status.keyHint ? `••••${status.keyHint}` : "—"}
              />
              <Field label={s.baseUrl} value={status.baseUrl || "—"} />
              <Field
                label={s.addedOn}
                value={
                  status.createdAt
                    ? new Date(status.createdAt).toLocaleDateString()
                    : "—"
                }
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={testConnection}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary px-4 py-2 text-sm font-medium text-foreground transition hover:opacity-80 disabled:opacity-50"
              >
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                {testing ? s.testing : s.testConnection}
              </button>
              <button
                onClick={removeKey}
                disabled={removing}
                className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition hover:bg-red-500/20 disabled:opacity-50"
              >
                {removing && <Loader2 className="h-4 w-4 animate-spin" />}
                {removing ? s.removing : s.remove}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {s.apiKey}
              </label>
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={s.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {s.baseUrl}
              </label>
              <input
                type="url"
                value={baseUrlInput}
                onChange={(e) => setBaseUrlInput(e.target.value)}
                placeholder={s.baseUrlPlaceholder}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {s.baseUrlHint}
              </p>
            </div>
            <div>
              <button
                onClick={saveKey}
                disabled={saving || keyInput.trim().length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? s.saving : s.save}
              </button>
            </div>
          </div>
        )}

        {notice && (
          <p
            className={`mt-4 text-sm ${notice.ok ? "text-emerald-400" : "text-red-400"}`}
          >
            {notice.text}
          </p>
        )}
      </Card>
    </div>
  );
}
