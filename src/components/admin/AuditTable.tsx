import type { AuditRow } from "@/server/admin/queries";
import { formatTime, TABLE, TableFrame, TD, THead } from "./AdminShell";

const OUTCOME_STYLE: Record<string, string> = {
  success: "text-emerald-700 dark:text-emerald-400",
  allow: "text-emerald-700 dark:text-emerald-400",
  step_up: "text-amber-700 dark:text-amber-400",
  failure: "text-red-700 dark:text-red-400",
  deny: "text-red-700 dark:text-red-400",
};

export function summariseEvent(e: Pick<AuditRow, "event_type" | "metadata">): string {
  const m = e.metadata;
  if (e.event_type === "access.decision") {
    const signals = (m.signals as string[] | undefined)?.join(", ");
    return `${m.reason} · risk ${m.riskScore}${signals ? ` (${signals})` : ""}`;
  }
  if (e.event_type === "device.posture.evaluated") {
    const failed = (m.failedChecks as string[] | undefined) ?? [];
    return `${m.device}${failed.length ? ` · failed: ${failed.join(", ")}` : " · compliant"}`;
  }
  if (e.event_type === "admin.action") {
    const parts = [String(m.action)];
    if (m.targetUser) parts.push(`user ${m.targetUser}`);
    if (m.device) parts.push(String(m.device));
    if (typeof m.sessionsRevoked === "number" && m.sessionsRevoked > 0) parts.push(`${m.sessionsRevoked} session(s) ended`);
    if (m.error) parts.push(`error: ${m.error}`);
    if (m.idpSynced === false) parts.push("Keycloak not updated");
    return parts.join(" · ");
  }
  if (typeof m.reason === "string") return m.reason;
  if (typeof m.code === "string") return m.code;
  return "";
}

export function AuditTable({ events }: { events: AuditRow[] }) {
  if (events.length === 0) return <p className="text-sm text-slate-500">No events match.</p>;
  return (
    <TableFrame>
      <table className={TABLE}>
        <THead cols={["Time", "User", "Event", "Outcome", "Details"]} />
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {events.map((e) => (
            <tr key={e.id}>
              <td className={`${TD} whitespace-nowrap tabular-nums text-slate-500`}>{formatTime(e.occurred_at)}</td>
              <td className={TD}>{e.username ?? "—"}</td>
              <td className={`${TD} font-mono text-xs`}>
                {e.event_type}
                {e.resource ? ` · ${e.resource}` : ""}
              </td>
              <td className={`${TD} font-medium ${OUTCOME_STYLE[e.outcome] ?? ""}`}>{e.outcome}</td>
              <td className={`${TD} text-slate-600 dark:text-slate-400`}>{summariseEvent(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableFrame>
  );
}
