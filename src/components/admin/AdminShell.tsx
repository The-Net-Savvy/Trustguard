import Link from "next/link";
import { RiskBadge } from "@/components/access/RiskPanel";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PostureHeartbeat } from "@/components/device/PostureHeartbeat";
import type { AccessContext } from "@/server/access/require-access";
import type { PolicyDecision } from "@/server/policy-engine/types";

const TABS = [
  ["/admin", "Overview"],
  ["/admin/sessions", "Sessions"],
  ["/admin/devices", "Devices"],
  ["/admin/users", "Users"],
  ["/admin/audit", "Audit log"],
] as const;

const NOTICES: Record<string, string> = {
  session_revoked: "Session ended. The user's Keycloak session was ended too.",
  user_signed_out: "User signed out of all sessions.",
  user_suspended: "User suspended: account disabled in Keycloak and all sessions ended.",
  user_reactivated: "User reactivated. They can sign in again.",
  device_trusted: "Device marked as trusted.",
  device_blocked: "Device blocked and its sessions ended.",
  device_reset: "Device returned to registered (not trusted, not blocked).",
};

const ERRORS: Record<string, string> = {
  invalid_request: "The request was not valid.",
  not_found: "That item no longer exists.",
  already_ended: "That session had already ended.",
  self_session: "You cannot end your own current session here. Use Sign out.",
  self_suspend: "You cannot suspend your own account.",
  self_device: "You cannot block the device you are using.",
  idp_failed: "Keycloak could not be updated, so nothing was changed. Try again.",
};

export type Flash = { notice?: string; error?: string; warning?: string };

export function flashFrom(params: Record<string, string | string[] | undefined>): Flash {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return { notice: one(params.notice), error: one(params.error), warning: one(params.warning) };
}

export function AdminShell({
  active,
  ctx,
  manage,
  flash,
  children,
}: {
  active: string;
  ctx: AccessContext;
  manage: PolicyDecision | null;
  flash: Flash;
  children: React.ReactNode;
}) {
  const notice = flash.notice ? NOTICES[flash.notice] : undefined;
  const error = flash.error ? ERRORS[flash.error] : undefined;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
      <PostureHeartbeat />
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Admin console</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            Signed in as {ctx.user.username} · <RiskBadge level={ctx.risk.level} score={ctx.risk.score} />
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 [scrollbar-width:none] dark:border-slate-800 [&::-webkit-scrollbar]:hidden">
        {TABS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={active === href ? "page" : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              active === href
                ? "border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {manage && manage.decision !== "allow" && (
        <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {manage.decision === "step_up" ? (
            <>
              Admin actions need a recent sign-in ({manage.explanation}){" "}
              <a className="font-medium underline" href={`/login?returnTo=${encodeURIComponent(active)}&reason=step_up`}>
                Confirm it is you
              </a>
            </>
          ) : (
            <>Admin actions are not available right now: {manage.explanation}</>
          )}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          {notice}
          {flash.warning === "idp_not_synced" &&
            " Warning: Keycloak could not be updated, so the user may still have an SSO session."}
        </p>
      )}
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      {children}
    </main>
  );
}

export function formatTime(d: Date | null) {
  return d ? d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export const TABLE = "w-full min-w-[720px] text-left text-sm";
export const TH = "px-3 py-2 font-medium";
export const TD = "px-3 py-2 align-top";

export function TableFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">{children}</div>
  );
}

export function THead({ cols }: { cols: string[] }) {
  return (
    <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
      <tr>
        {cols.map((c) => (
          <th key={c} className={TH}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}
