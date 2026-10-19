"use client";

import type { AdminActionKind } from "@/server/admin/types";

/**
 * A single admin action as a plain form post to /api/admin/actions, so it works
 * without JavaScript; with JavaScript, destructive actions ask for confirmation.
 */
export function ActionButton({
  action,
  target,
  returnTo,
  label,
  confirm,
  tone = "neutral",
  disabled = false,
}: {
  action: AdminActionKind;
  target: string;
  returnTo: string;
  label: string;
  confirm?: string;
  tone?: "neutral" | "danger" | "positive";
  disabled?: boolean;
}) {
  const tones = {
    neutral: "border-slate-300 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800",
    danger: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950",
    positive:
      "border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950",
  };
  return (
    <form
      action="/api/admin/actions"
      method="post"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="target" value={target} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        disabled={disabled}
        className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]}`}
      >
        {label}
      </button>
    </form>
  );
}
