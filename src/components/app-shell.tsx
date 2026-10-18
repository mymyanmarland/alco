"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ChevronsLeft,
  CreditCard,
  FolderKanban,
  Hammer,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  TerminalSquare,
  Rocket,
  X,
  type LucideIcon,
} from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { useTheme } from "@/components/theme-provider";
import { authClient } from "@/lib/auth-client";
import type { Dictionary } from "@/i18n/dictionaries";
import { cn } from "@/lib/utils";

export type ShellUser = {
  name?: string | null;
  email: string;
};

type NavItem = {
  href: string;
  icon: LucideIcon;
  labelKey: keyof Dictionary["nav"];
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", icon: LayoutDashboard, labelKey: "dashboard" },
  { href: "/chat", icon: MessageSquare, labelKey: "chat" },
  { href: "/projects", icon: FolderKanban, labelKey: "projects" },
  { href: "/builder", icon: Hammer, labelKey: "builder" },
  { href: "/sandbox", icon: TerminalSquare, labelKey: "sandbox" },
  { href: "/deployments", icon: Rocket, labelKey: "deployments" },
  { href: "/marketplace", icon: Store, labelKey: "marketplace" },
  { href: "/billing", icon: CreditCard, labelKey: "billing" },
  { href: "/settings", icon: Settings, labelKey: "settings" },
  { href: "/admin", icon: ShieldCheck, labelKey: "admin" },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-xl bg-white p-1.5 shadow-sm">
      <Image
        src="/logo.png"
        alt="ALCO logo"
        width={size}
        height={size}
        className="rounded-lg"
        priority
      />
    </span>
  );
}

function SidebarNav({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { t } = useLocale();
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? t.nav[item.labelKey] : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              collapsed && "justify-center px-0",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5 shrink-0",
                active ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
              )}
            />
            {!collapsed && <span className="truncate">{t.nav[item.labelKey]}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function LocaleToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLocale();
  return (
    <div
      className="flex items-center rounded-xl border border-border bg-card p-1 text-xs font-medium"
      role="group"
      aria-label="Language"
    >
      <Languages className="mx-1 h-4 w-4 text-muted-foreground" />
      {(["en", "my"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={cn(
            "rounded-lg px-2 py-1 transition-colors",
            locale === l
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
            compact && "px-1.5",
          )}
        >
          {l === "en" ? "EN" : "မြန်မာ"}
        </button>
      ))}
    </div>
  );
}

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={t.shell.toggleTheme}
      aria-label={t.shell.toggleTheme}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-foreground"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function SignOutButton() {
  const { t } = useLocale();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await authClient.signOut();
        } finally {
          router.push("/login");
          router.refresh();
        }
      }}
      title={t.shell.signOut}
      aria-label={t.shell.signOut}
      className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden sm:inline">{t.shell.signOut}</span>
    </button>
  );
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user?: ShellUser | null;
}) {
  const { t } = useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] duration-200 md:flex",
          collapsed ? "w-[76px]" : "w-64",
        )}
      >
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
          <Link href="/dashboard" className="flex items-center gap-2.5" aria-label="ALCO home">
            <Logo size={32} />
            {!collapsed && (
              <span className="truncate text-base font-bold tracking-tight">
                {t.brand.name}
              </span>
            )}
          </Link>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          <SidebarNav collapsed={collapsed} />
        </div>
        <div className="border-t border-sidebar-border p-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? t.shell.expand : t.shell.collapse}
            aria-label={collapsed ? t.shell.expand : t.shell.collapse}
            className="flex w-full items-center justify-center rounded-xl px-3 py-2 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ChevronsLeft
              className={cn("h-5 w-5 transition-transform", collapsed && "rotate-180")}
            />
            {!collapsed && <span className="ml-2 text-sm">{t.shell.collapse}</span>}
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-sidebar-border bg-sidebar">
            <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5"
                aria-label="ALCO home"
              >
                <Logo size={32} />
                <span className="text-base font-bold tracking-tight">{t.brand.name}</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label={t.shell.closeMenu}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-4">
              <SidebarNav collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground md:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label={t.shell.openMenu}
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-medium text-muted-foreground">{t.shell.workspace}</span>
          <div className="ml-auto flex items-center gap-2">
            {user?.email && (
              <span
                className="hidden max-w-44 truncate text-sm text-muted-foreground md:inline"
                title={user.email}
              >
                {user.email}
              </span>
            )}
            <LocaleToggle />
            <ThemeToggle />
            {user ? (
              <SignOutButton />
            ) : (
              <Link
                href="/login"
                className="hidden rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90 sm:inline-flex"
              >
                {t.shell.signIn}
              </Link>
            )}
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
