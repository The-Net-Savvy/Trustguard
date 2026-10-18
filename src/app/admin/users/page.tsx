import Link from "next/link";
import { ActionButton } from "@/components/admin/ActionButton";
import { AdminShell, flashFrom, formatTime, TABLE, TableFrame, TD, THead } from "@/components/admin/AdminShell";
import { adminPageContext } from "@/server/admin/page-context";
import { listUsers } from "@/server/admin/queries";

export const metadata = { title: "Users · Admin · Trust Guard" };

const ROLE_LABELS: Record<string, string> = { "tg-admin": "Administrator", "tg-employee": "Employee" };

export default async function AdminUsersPage({ searchParams }: PageProps<"/admin/users">) {
  const { ctx, manage, canManage } = await adminPageContext("/admin/users");
  const users = await listUsers();

  return (
    <AdminShell active="/admin/users" ctx={ctx} manage={manage} flash={flashFrom(await searchParams)}>
      <h2 className="mb-1 text-lg font-semibold">Users ({users.length})</h2>
      <p className="mb-3 text-sm text-slate-500">
        Accounts and roles are managed in Keycloak; users appear here after their first sign-in.{" "}
        <strong>Suspend</strong> disables the account in Keycloak and ends all sessions.
      </p>
      <TableFrame>
        <table className={TABLE}>
          <THead cols={["User", "Roles", "Last sign-in", "Sessions", "Devices", "Status", ""]} />
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {users.map((u) => {
              const self = u.id === ctx.user.id;
              return (
                <tr key={u.id}>
                  <td className={TD}>
                    <span className="font-medium">{u.username}</span>
                    {self && <span className="ml-1 text-xs text-slate-500">(you)</span>}
                    <div className="text-xs text-slate-500">{u.display_name ?? u.email ?? ""}</div>
                  </td>
                  <td className={TD}>{u.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "—"}</td>
                  <td className={`${TD} tabular-nums`}>{formatTime(u.last_login_at)}</td>
                  <td className={`${TD} tabular-nums`}>{u.active_sessions}</td>
                  <td className={`${TD} tabular-nums`}>{u.devices}</td>
                  <td className={TD}>
                    {u.suspended_at ? (
                      <span className="text-red-700 dark:text-red-400">
                        Suspended
                        <div className="text-xs text-slate-500">
                          by {u.suspended_by ?? "—"}, {formatTime(u.suspended_at)}
                        </div>
                      </span>
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      <ActionButton
                        action="sign_out_user"
                        target={u.id}
                        returnTo="/admin/users"
                        label={self ? "Sign out other sessions" : "Sign out everywhere"}
                        confirm={`End all of ${u.username}'s sessions${self ? " except this one" : ""}?`}
                        disabled={!canManage || u.active_sessions === 0}
                      />
                      {u.suspended_at ? (
                        <ActionButton action="reactivate_user" target={u.id} returnTo="/admin/users" label="Reactivate" tone="positive" disabled={!canManage} />
                      ) : (
                        <ActionButton
                          action="suspend_user"
                          target={u.id}
                          returnTo="/admin/users"
                          label="Suspend"
                          tone="danger"
                          confirm={`Suspend ${u.username}? Their account is disabled and all sessions end.`}
                          disabled={!canManage || self}
                        />
                      )}
                      <Link
                        href={`/admin/audit?user=${encodeURIComponent(u.username)}`}
                        className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-slate-500 underline-offset-4 hover:underline"
                      >
                        Activity
                      </Link>
                    </div>
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
