"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";

interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  projectCount: number;
}

interface AdminFailure {
  id: string;
  userId: string;
  projectId: string | null;
  status: string;
  exitCode: number | null;
  durationMs: number | null;
  driver: string | null;
  createdAt: string;
}

interface AdminOverview {
  users: { count: number; list: AdminUser[] };
  totals: { projects: number };
  failures: AdminFailure[];
  usage: { aiTokensToday: number; sandboxMsToday: number };
  health: { db: boolean; sandboxDriver: string; aiConfigured: boolean };
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

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        ok
          ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
          : "border-red-500/30 bg-red-500/15 text-red-400"
      }`}
    >
      {label}
    </span>
  );
}

export default function AdminPage() {
  const { t } = useLocale();
  const s = t.adminPage;
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDenied(false);
    try {
      const res = await fetch("/api/admin/overview");
      if (res.status === 404) {
        setDenied(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : s.loadError);
    } finally {
      setLoading(false);
    }
  }, [s.loadError]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial client-side data load on mount; client-only page
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        {s.loading}
      </div>
    );
  }

  if (denied) {
    return (
      <div className="rounded-2xl border border-border bg-card p-10 text-center text-muted-foreground">
        <ShieldCheck className="mx-auto mb-3 h-10 w-10" />
        {s.notFound}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm">
        {s.loadError}
        {error ? ` (${error})` : ""}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold tracking-tight">{s.title}</h1>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title={s.health} icon={<Activity className="h-4 w-4" />}>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt>{s.database}</dt>
              <dd>
                <Badge
                  ok={data.health.db}
                  label={data.health.db ? s.ok : s.down}
                />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>{s.sandboxDriver}</dt>
              <dd className="font-mono text-xs">{data.health.sandboxDriver}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>{s.aiProvider}</dt>
              <dd>
                <Badge
                  ok={data.health.aiConfigured}
                  label={
                    data.health.aiConfigured ? s.configured : s.notConfigured
                  }
                />
              </dd>
            </div>
          </dl>
        </Card>

        <Card title={s.usage} icon={<Database className="h-4 w-4" />}>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt>{s.aiTokens}</dt>
              <dd className="font-mono">
                {data.usage.aiTokensToday.toLocaleString()}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>{s.sandboxMinutes}</dt>
              <dd className="font-mono">
                {(data.usage.sandboxMsToday / 60000).toFixed(1)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card
          title={`${s.users} (${data.users.count})`}
          icon={<Users className="h-4 w-4" />}
        >
          <p className="text-sm text-muted-foreground">
            {s.projects}:{" "}
            <span className="font-mono text-foreground">
              {data.totals.projects}
            </span>
          </p>
        </Card>
      </div>

      <Card title={s.users} icon={<Users className="h-4 w-4" />}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                <th className="py-2 pr-4 font-medium">{s.email}</th>
                <th className="py-2 pr-4 font-medium">{s.joined}</th>
                <th className="py-2 font-medium">{s.projects}</th>
              </tr>
            </thead>
            <tbody>
              {data.users.list.map((u) => (
                <tr key={u.id} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs">{u.email}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {new Date(u.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 font-mono">{u.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={s.failures} icon={<AlertTriangle className="h-4 w-4" />}>
        {data.failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s.noFailures}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{s.time}</th>
                  <th className="py-2 pr-4 font-medium">{s.status}</th>
                  <th className="py-2 pr-4 font-medium">{s.duration}</th>
                  <th className="py-2 pr-4 font-medium">{s.driver}</th>
                  <th className="py-2 font-medium">{s.project}</th>
                </tr>
              </thead>
              <tbody>
                {data.failures.map((f) => (
                  <tr key={f.id} className="border-b border-border/50">
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {new Date(f.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/15 px-2.5 py-0.5 text-xs font-medium text-red-400">
                        {f.status}
                        {f.exitCode != null ? ` (${f.exitCode})` : ""}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {f.durationMs != null
                        ? `${(f.durationMs / 1000).toFixed(1)} s`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {f.driver ?? "—"}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {f.projectId ? f.projectId.slice(0, 8) + "…" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
