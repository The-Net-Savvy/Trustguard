import { CircleCheck, CircleX } from "lucide-react";
import { Card, CardTitle, Pill, type Tone } from "@/components/ui/cards";
import type { PostureAssessment } from "@/server/device-posture/types";
import type { RiskAssessment, RiskLevel } from "@/server/risk-engine/types";

export const LEVEL_TONE: Record<RiskLevel, Tone> = { low: "good", medium: "warn", high: "bad" };

export function RiskBadge({ level, score }: { level: RiskLevel; score: number }) {
  return (
    <Pill tone={LEVEL_TONE[level]}>
      {level[0].toUpperCase() + level.slice(1)} risk · {score}/100
    </Pill>
  );
}

/** Risk signals and device posture checks, as evaluated for the current request. */
export function RiskPanel({ risk, posture }: { risk: RiskAssessment; posture: PostureAssessment }) {
  const passed = posture.checks.filter((c) => c.passed).length;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle title="Risk signals" hint="What raised the score on this request" />
        {risk.signals.length === 0 ? (
          <p className="text-sm text-muted">No risk signals. Everything about this request looks normal.</p>
        ) : (
          <ul className="space-y-4">
            {risk.signals.map((s) => (
              <li key={s.code}>
                <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
                  <span>{s.description}</span>
                  <span className="shrink-0 font-semibold tabular-nums text-ink">+{s.weight}</span>
                </div>
                <div className="h-2 rounded-full bg-panel">
                  <div
                    className={`h-2 rounded-full ${s.weight >= 40 ? "bg-rose-500" : s.weight >= 20 ? "bg-amber-400" : "bg-brand"}`}
                    style={{ width: `${Math.min(100, s.weight)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4 text-sm">
          <span className="text-muted">Total score (low &lt; 30 · medium 30–59 · high ≥ 60)</span>
          <RiskBadge level={risk.level} score={risk.score} />
        </div>
      </Card>
      <Card>
        <CardTitle title="Device checks" hint={`${passed} of ${posture.checks.length} passed`} />
        <ul className="space-y-3">
          {posture.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 text-sm">
              {c.passed ? (
                <CircleCheck className="mt-0.5 size-[18px] shrink-0 text-emerald-500" strokeWidth={2} aria-label="Passed" />
              ) : (
                <CircleX className="mt-0.5 size-[18px] shrink-0 text-rose-500" strokeWidth={2} aria-label="Failed" />
              )}
              <span className={c.passed ? "text-ink/80" : "font-semibold text-ink"}>{c.detail}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
