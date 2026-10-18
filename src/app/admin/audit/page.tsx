import { AdminShell, flashFrom } from "@/components/admin/AdminShell";
import { AuditTable } from "@/components/admin/AuditTable";
import { cleanAuditFilters } from "@/server/admin/filters";
import { adminPageContext } from "@/server/admin/page-context";
import { auditEventTypes, queryAudit } from "@/server/admin/queries";

export const metadata = { title: "Audit log · Admin · Trust Guard" };

const OUTCOMES = ["success", "failure", "allow", "step_up", "deny"];
const INPUT =
  "rounded-md border border-slate-300 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700 [color-scheme:light] dark:[color-scheme:dark]";

export default async function AdminAuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const params = await searchParams;
  const { ctx, manage } = await adminPageContext("/admin/audit");
  const filters = cleanAuditFilters(params);
  const [events, types] = await Promise.all([queryAudit(filters, 200), auditEventTypes()]);
  const exportQuery = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => typeof e[1] === "string"),
  ).toString();

  return (
    <AdminShell active="/admin/audit" ctx={ctx} manage={manage} flash={flashFrom(params)}>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Event
          <select name="type" defaultValue={filters.type ?? ""} className={INPUT}>
            <option value="">All</option>
            {types.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          Outcome
          <select name="outcome" defaultValue={filters.outcome ?? ""} className={INPUT}>
            <option value="">All</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          User
          <input name="user" defaultValue={filters.user ?? ""} placeholder="username" className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          From
          <input type="date" name="from" defaultValue={filters.from ?? ""} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          To
          <input type="date" name="to" defaultValue={filters.to ?? ""} className={INPUT} />
        </label>
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          Filter
        </button>
        <a href="/admin/audit" className="py-1.5 text-sm text-slate-500 underline-offset-4 hover:underline">
          Clear
        </a>
        <a
          href={`/api/admin/audit/export${exportQuery ? `?${exportQuery}` : ""}`}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          Export CSV
        </a>
      </form>
      <p className="mb-2 text-xs text-slate-500">
        Showing the latest {events.length} matching events (max 200 here; the export includes up to 10,000).
        The audit log is append-only: entries cannot be edited or deleted.
      </p>
      <AuditTable events={events} />
    </AdminShell>
  );
}
