import Link from "next/link";
import { AdminShell, flashFrom } from "@/components/admin/AdminShell";
import { AuditTable } from "@/components/admin/AuditTable";
import { adminPageContext } from "@/server/admin/page-context";
import { adminStats, queryAudit } from "@/server/admin/queries";

export const metadata = { title: "Admin console · Trust Guard" };

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const { ctx, manage } = await adminPageContext("/admin");
  const [stats, events] = await Promise.all([adminStats(), queryAudit({}, 20)]);

  const tiles: [string, number, string][] = [
    ["Active sessions", stats.active_sessions, "/admin/sessions"],
    ["Users", stats.users, "/admin/users"],
    ["Suspended users", stats.suspended_users, "/admin/users"],
    ["Registered devices", stats.devices, "/admin/devices"],
    ["Blocked devices", stats.blocked_devices, "/admin/devices"],
    ["Denials / failures (24 h)", stats.denials_24h, "/admin/audit?outcome=deny"],
  ];

  return (
    <AdminShell active="/admin" ctx={ctx} manage={manage} flash={flashFrom(await searchParams)}>
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map(([label, value, href]) => (
          <Link
            key={label}
            href={href}
            className="rounded-lg border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-900"
          >
            <p className="text-sm text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          </Link>
        ))}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Recent security events</h2>
          <Link href="/admin/audit" className="text-sm text-slate-500 underline-offset-4 hover:underline">
            Full audit log
          </Link>
        </div>
        <AuditTable events={events} />
      </section>
    </AdminShell>
  );
}
