import { CircleAlert, CircleCheck, ShieldAlert } from "lucide-react";
import { RiskBadge } from "@/components/access/RiskPanel";
import { PostureHeartbeat } from "@/components/device/PostureHeartbeat";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import type { AccessContext } from "@/server/access/require-access";
import type { PolicyDecision } from "@/server/policy-engine/types";

const PAGES: Record<string, { title: string; subtitle: string }> = {
  "/admin": { title: "Security overview", subtitle: "Sessions, devices and access decisions across the company." },
  "/admin/sessions": { title: "Active sessions", subtitle: "Who is signed in, from which device, at what risk." },
  "/admin/devices": { title: "Devices", subtitle: "Trust or block the browsers and devices people sign in from." },
  "/admin/users": { title: "Users", subtitle: "Accounts, roles and activity. Suspend access in one step." },
  "/admin/audit": { title: "Audit log", subtitle: "Every sign-in, access decision and admin action. Append-only." },
};

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

const BANNER = "mb-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-sm";

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
  const page = PAGES[active] ?? PAGES["/admin"];
  const notice = flash.notice ? NOTICES[flash.notice] : undefined;
  const error = flash.error ? ERRORS[flash.error] : undefined;

  return (
    <AppShell user={ctx.user} active={active}>
      <PostureHeartbeat />
      <PageHeader
        title={page.title}
        subtitle={page.subtitle}
        aside={
          <span className="flex items-center gap-2 text-sm text-muted">
            Your access <RiskBadge level={ctx.risk.level} score={ctx.risk.score} />
          </span>
        }
      />

      {manage && manage.decision !== "allow" && (
        <p className={`${BANNER} bg-amber-50 text-amber-900 ring-1 ring-amber-200`}>
          <ShieldAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {manage.decision === "step_up" ? (
              <>
                Admin actions need a recent sign-in ({manage.explanation}){" "}
                <a className="font-semibold underline" href={`/login?returnTo=${encodeURIComponent(active)}&reason=step_up`}>
                  Confirm it is you
                </a>
              </>
            ) : (
              <>Admin actions are not available right now: {manage.explanation}</>
            )}
          </span>
        </p>
      )}
      {notice && (
        <p role="status" className={`${BANNER} bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200`}>
          <CircleCheck className="mt-0.5 size-4 shrink-0" />
          <span>
            {notice}
            {flash.warning === "idp_not_synced" &&
              " Warning: Keycloak could not be updated, so the user may still have an SSO session."}
          </span>
        </p>
      )}
      {error && (
        <p role="alert" className={`${BANNER} bg-rose-50 text-rose-900 ring-1 ring-rose-200`}>
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {children}
    </AppShell>
  );
}

export function formatTime(d: Date | null) {
  return d ? d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
}

export const TABLE = "w-full min-w-[760px] text-left text-sm";
export const TH = "px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted";
export const TD = "px-4 py-3.5 align-top";

/** A white rounded card holding a horizontally scrollable table. */
export function TableFrame({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-3xl bg-card p-2">{children}</div>;
}

export function THead({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="[&>th:first-child]:rounded-l-2xl [&>th:last-child]:rounded-r-2xl bg-panel">
        {cols.map((c, i) => (
          <th key={`${c}-${i}`} className={TH}>
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}
