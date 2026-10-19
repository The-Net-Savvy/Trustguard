import { AdminShell, flashFrom } from "@/components/admin/AdminShell";
import { AuditTable } from "@/components/admin/AuditTable";
import { Card, CardTitle, StatCard } from "@/components/ui/cards";
import { BarChart, DonutChart } from "@/components/ui/charts";
import { adminPageContext } from "@/server/admin/page-context";
import { adminStats, eventsPerDay, outcomeTotals, queryAudit } from "@/server/admin/queries";

export const metadata = { title: "Admin overview · Trust Guard" };

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });

export default async function AdminOverviewPage({ searchParams }: PageProps<"/admin">) {
  const { ctx, manage } = await adminPageContext("/admin");
  const [stats, events, perDay, outcomes] = await Promise.all([
    adminStats(),
    queryAudit({}, 8),
    eventsPerDay(7),
    outcomeTotals(7),
  ]);
  const weekTotal = perDay.reduce((s, d) => s + d.events, 0);

  return (
    <AdminShell active="/admin" ctx={ctx} manage={manage} flash={flashFrom(await searchParams)}>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard band="blue" label="Active sessions" value={stats.active_sessions} sub={`${stats.users} users in total`} href="/admin/sessions" />
        <StatCard band="orange" label="Suspended users" value={stats.suspended_users} sub="Accounts disabled in Keycloak" href="/admin/users" />
        <StatCard band="yellow" label="Blocked devices" value={stats.blocked_devices} sub={`of ${stats.devices} registered devices`} href="/admin/devices" />
        <StatCard band="green" label="Denials and failures" value={stats.denials_24h} sub="Last 24 hours" href="/admin/audit?outcome=deny" />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardTitle title="Security events" hint={`Last 7 days · ${weekTotal.toLocaleString("en-GB")} events`} href="/admin/audit" />
          <BarChart
            ariaLabel="Security events per day over the last 7 days"
            unit="events"
            data={perDay.map((d) => ({ label: weekday(d.day), value: d.events }))}
          />
        </Card>
        <Card className="xl:col-span-2">
          <CardTitle title="Outcomes" hint="Last 7 days" href="/admin/audit" />
          <DonutChart
            ariaLabel="Security event outcomes over the last 7 days"
            centre={(outcomes.allowed + outcomes.stepUp + outcomes.denied).toLocaleString("en-GB")}
            data={[
              { label: "Allowed or succeeded", value: outcomes.allowed, color: "#4a3aff" },
              { label: "Step-up (sign in again)", value: outcomes.stepUp, color: "#f7c948" },
              { label: "Denied or failed", value: outcomes.denied, color: "#f2706b" },
            ]}
          />
        </Card>
      </div>

      <Card>
        <CardTitle title="Recent security events" hint="Newest first" href="/admin/audit" />
        <AuditTable events={events} />
      </Card>
    </AdminShell>
  );
}
