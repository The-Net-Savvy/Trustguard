import type { PostureAssessment } from "@/server/device-posture/types";
import type { RiskAssessment, RiskLevel } from "@/server/risk-engine/types";

const LEVEL_STYLE: Record<RiskLevel, string> = {
  low: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export function RiskBadge({ level, score }: { level: RiskLevel; score: number }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${LEVEL_STYLE[level]}`}>
      {level[0].toUpperCase() + level.slice(1)} risk · {score}/100
    </span>
  );
}

/** Risk signals and device posture checks, as evaluated for the current request. */
export function RiskPanel({ risk, posture }: { risk: RiskAssessment; posture: PostureAssessment }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Risk signals</h3>
          <RiskBadge level={risk.level} score={risk.score} />
        </div>
        {risk.signals.length === 0 ? (
          <p className="text-sm text-slate-500">No risk signals.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {risk.signals.map((s) => (
              <li key={s.code} className="flex justify-between gap-3">
                <span>{s.description}</span>
                <span className="shrink-0 tabular-nums text-slate-500">+{s.weight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
        <h3 className="mb-3 text-sm font-semibold">Device checks</h3>
        <ul className="space-y-2 text-sm">
          {posture.checks.map((c) => (
            <li key={c.id} className="flex gap-2">
              <span aria-hidden className={c.passed ? "text-emerald-600" : "text-red-600"}>
                {c.passed ? "✓" : "✗"}
              </span>
              <span className={c.passed ? "" : "font-medium"}>{c.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
