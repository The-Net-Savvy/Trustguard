import Link from "next/link";
import {
  Activity,
  Bell,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  MonitorSmartphone,
  PieChart,
  ScrollText,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { SessionUser } from "@/server/session/types";

/**
 * The signed-in app frame (dashboard and admin console): a slim icon sidebar, a top
 * bar, and the page on a light panel. Admin items appear only for administrators;
 * the pages themselves still enforce access, the sidebar only hides what a user
 * cannot open.
 */

const NAV = [
  { href: "/dashboard", label: "My security", icon: LayoutDashboard, admin: false },
  { href: "/admin", label: "Admin overview", icon: PieChart, admin: true },
  { href: "/admin/sessions", label: "Sessions", icon: Activity, admin: true },
  { href: "/admin/devices", label: "Devices", icon: MonitorSmartphone, admin: true },
  { href: "/admin/users", label: "Users", icon: Users, admin: true },
  { href: "/admin/audit", label: "Audit log", icon: ScrollText, admin: true },
] as const;

function initials(user: SessionUser) {
  const name = user.displayName ?? user.username;
  return name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function AppShell({
  user,
  active,
  children,
}: {
  user: SessionUser;
  active: string;
  children: React.ReactNode;
}) {
  const isAdmin = user.roles.includes("tg-admin");
  const today = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="flex flex-1 p-0 sm:p-4 lg:p-6">
      <div className="mx-auto flex w-full max-w-[1440px] overflow-hidden bg-panel sm:rounded-[28px] sm:shadow-[0_20px_60px_-30px_rgba(40,60,140,0.35)]">
        {/* Sidebar */}
        <aside className="flex w-[72px] shrink-0 flex-col items-center gap-2 bg-card py-6 sm:w-20">
          <Link href="/dashboard" aria-label="Trust Guard" className="mb-6 text-brand">
            <ShieldCheck className="size-8" strokeWidth={2.2} />
          </Link>
          <nav className="flex flex-1 flex-col items-center gap-2" aria-label="Main">
            {NAV.filter((item) => !item.admin || isAdmin).map((item) => {
              const current = active === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={current ? "page" : undefined}
                  className={`grid size-11 place-items-center rounded-2xl transition-colors ${
                    current ? "bg-ink text-white shadow-md" : "text-muted hover:bg-panel hover:text-ink"
                  }`}
                >
                  <Icon className="size-5" strokeWidth={1.8} />
                </Link>
              );
            })}
          </nav>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="grid size-11 place-items-center rounded-2xl text-muted hover:bg-panel hover:text-ink"
            >
              <LogOut className="size-5" strokeWidth={1.8} />
            </button>
          </form>
        </aside>

        {/* Main */}
        <div className="flex min-w-0 flex-1 flex-col px-4 py-5 sm:px-8 sm:py-6">
          <header className="mb-6 flex items-center gap-3">
            {isAdmin ? (
              <form action="/admin/audit" method="get" className="relative hidden w-full max-w-xs sm:block">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  name="user"
                  placeholder="Search activity by user"
                  aria-label="Search activity by user"
                  className="w-full rounded-full bg-card py-2.5 pl-10 pr-4 text-sm outline-none ring-brand/30 placeholder:text-muted focus:ring-2"
                />
              </form>
            ) : null}
            <span className="hidden items-center gap-2 text-sm font-semibold text-brand md:inline-flex">
              <CalendarDays className="size-4" /> Today, {today}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {isAdmin && (
                <Link
                  href="/admin/audit?outcome=deny"
                  title="Recent denials"
                  aria-label="Recent denials"
                  className="grid size-10 place-items-center rounded-full bg-card text-ink hover:bg-white/70"
                >
                  <Bell className="size-[18px]" strokeWidth={1.8} />
                </Link>
              )}
              <div className="flex items-center gap-3 rounded-full bg-card py-1 pl-1 pr-4">
                <span className="grid size-8 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  {initials(user)}
                </span>
                <span className="hidden text-sm font-semibold sm:inline">{user.username}</span>
              </div>
            </div>
          </header>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Page heading row: title + subtitle on the left, optional content on the right. */
export function PageHeader({
  title,
  subtitle,
  aside,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {aside}
    </div>
  );
}
