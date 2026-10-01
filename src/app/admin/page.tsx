import Link from "next/link";
import { RiskBadge } from "@/components/access/RiskPanel";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { PostureHeartbeat } from "@/components/device/PostureHeartbeat";
import { requireAccess } from "@/server/access/require-access";
import { query } from "@/server/db/client";

export const metadata = { title: "Admin console · Trust Guard" };

interface EventRow {
  id: string;
  occurred_at: Date;
  event_type: string;
  outcome: string;
  username: string | null;
  resource: string | null;
  metadata: Record<string, unknown>;
}

const OUTCOME_STYLE: Record<string, string> = {
  success: "text-emerald-700 dark:text-emerald-400",
  allow: "text-emerald-700 dark:text-emerald-400",
  step_up: "text-amber-700 dark:text-amber-400",
  failure: "text-red-700 dark:text-red-400",
  deny: "text-red-700 dark:text-red-400",
};

function summarise(e: EventRow): string {
  const m = e.metadata;
  if (e.event_type === "access.decision") {
    const signals = (m.signals as string[] | undefined)?.join(", ");
    return `${m.reason} · risk ${m.riskScore}${signals ? ` (${signals})` : ""}`;
  }
  if (e.event_type === "device.posture.evaluated") {
    const failed = (m.failedChecks as string[] | undefined) ?? [];
    return `${m.device}${failed.length ? ` · failed: ${failed.join(", ")}` : " · compliant"}`;
  }
  if (typeof m.reason === "string") return m.reason;
  if (typeof m.code === "string") return m.code;
  return "";
}

export default async function AdminPage() {
  const { risk } = await requireAccess("admin.console", "/admin");

  const [{ rows: events }, { rows: stats }] = await Promise.all([
    query<EventRow>(
      `select a.id, a.occurred_at, a.event_type, a.outcome, u.username, a.resource, a.metadata
         from trustguard.audit_events a
         left join trustguard.users u on u.id = a.actor_user_id
        order by a.id desc limit 50`,
    ),
    query<{ active_sessions: number; devices: number; denials_24h: number }>(
      `select
         (select count(*)::int from trustguard.sessions where status = 'active' and absolute_expires_at > now()) as active_sessions,
         (select count(*)::int from trustguard.devices) as devices,
         (select count(*)::int from trustguard.audit_events
           where outcome in ('deny', 'failure') and occurred_at > now() - interval '24 hours') as denials_24h`,
    ),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
      <PostureHeartbeat />
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Admin console</h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            Your access: <RiskBadge level={risk.level} score={risk.score} />
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

      <section className="mb-8 grid gap-3 sm:grid-cols-3">
        {[
          ["Active sessions", stats[0].active_sessions],
          ["Registered devices", stats[0].devices],
          ["Denials / failures (24 h)", stats[0].denials_24h],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent security events</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Outcome</th>
                <th className="px-3 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-500">
                    {e.occurred_at.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                  <td className="px-3 py-2">{e.username ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {e.event_type}
                    {e.resource ? ` · ${e.resource}` : ""}
                  </td>
                  <td className={`px-3 py-2 font-medium ${OUTCOME_STYLE[e.outcome] ?? ""}`}>{e.outcome}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{summarise(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Read-only view of the append-only audit log. Session, device and policy management follow in the
          administrative controls phase.
        </p>
      </section>
    </main>
  );
}
