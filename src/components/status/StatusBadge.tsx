import type { ComponentStatus } from "@/server/health/checks";

const styles: Record<ComponentStatus, string> = {
  ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  not_configured: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  error: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

const labels: Record<ComponentStatus, string> = {
  ok: "Healthy",
  not_configured: "Not configured",
  error: "Error",
};

export function StatusBadge({ status }: { status: ComponentStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
