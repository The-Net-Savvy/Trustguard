import type { ComponentStatus } from "@/server/health/checks";

const styles: Record<ComponentStatus, string> = {
  ok: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  not_configured: "bg-amber-50 text-amber-700 ring-amber-200",
  error: "bg-rose-50 text-rose-600 ring-rose-200",
};

const labels: Record<ComponentStatus, string> = {
  ok: "Healthy",
  not_configured: "Not configured",
  error: "Error",
};

export function StatusBadge({ status }: { status: ComponentStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
