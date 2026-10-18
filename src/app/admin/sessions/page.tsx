import { ActionButton } from "@/components/admin/ActionButton";
import { AdminShell, flashFrom, formatTime, TABLE, TableFrame, TD, THead } from "@/components/admin/AdminShell";
import { adminPageContext } from "@/server/admin/page-context";
import { listActiveSessions } from "@/server/admin/queries";

export const metadata = { title: "Sessions · Admin · Trust Guard" };

/** The most severe risk level recorded for the session's latest decisions. */
function riskOf(lastAccess: Record<string, string>): string {
  const levels = Object.values(lastAccess).map((v) => v.split(":")[1]);
  return ["high", "medium", "low"].find((l) => levels.includes(l)) ?? "—";
}

export default async function AdminSessionsPage({ searchParams }: PageProps<"/admin/sessions">) {
  const { ctx, manage, canManage } = await adminPageContext("/admin/sessions");
  const sessions = await listActiveSessions();

  return (
    <AdminShell active="/admin/sessions" ctx={ctx} manage={manage} flash={flashFrom(await searchParams)}>
      <h2 className="mb-1 text-lg font-semibold">Active sessions ({sessions.length})</h2>
      <p className="mb-3 text-sm text-slate-500">
        Ending a session signs the user out immediately, here and in Keycloak, so they must sign in again with a
        password and one-time code.
      </p>
      <TableFrame>
        <table className={TABLE}>
          <THead cols={["User", "Device", "IP", "Signed in", "Last activity", "Risk", ""]} />
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {sessions.map((s) => {
              const own = s.id === ctx.session.id;
              return (
                <tr key={s.id}>
                  <td className={TD}>
                    <span className="font-medium">{s.username}</span>
                    {own && <span className="ml-1 text-xs text-slate-500">(you, this session)</span>}
                  </td>
                  <td className={TD}>
                    {s.device_label ?? <span className="text-slate-400">not verified yet</span>}
                    {s.device_status && s.device_status !== "registered" && (
                      <span className="ml-1 text-xs text-slate-500">({s.device_status})</span>
                    )}
                  </td>
                  <td className={`${TD} font-mono text-xs`}>{s.ip_address ?? "—"}</td>
                  <td className={`${TD} tabular-nums`}>{formatTime(s.created_at)}</td>
                  <td className={`${TD} tabular-nums`}>{formatTime(s.last_seen_at)}</td>
                  <td className={TD}>{riskOf(s.last_access)}</td>
                  <td className={TD}>
                    <ActionButton
                      action="revoke_session"
                      target={s.id}
                      returnTo="/admin/sessions"
                      label="End session"
                      tone="danger"
                      confirm={`End ${s.username}'s session? They will have to sign in again.`}
                      disabled={!canManage || own}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </AdminShell>
  );
}
