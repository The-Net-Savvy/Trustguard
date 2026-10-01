import type { PostureCheckId } from "@/server/device-posture/types";
import type { RiskConfig, RiskInput, RiskAssessment, RiskLevel, RiskSignal, RiskSignalCode } from "./types";

/**
 * Risk scoring (pure: no I/O, unit-tested in tests/risk-engine.test.ts).
 *
 * Additive model: each signal that fires adds its weight; the sum is capped at 100.
 * Weights reflect how strongly a signal indicates compromise:
 *   70  automation driving the browser (bots, credential stuffing tools)
 *   40  posture report contradicts the request, or no secure context
 *   20  outdated browser, new device, repeated failed logins
 *   15  unsupported OS or browser, network change mid-session
 *   10  off the corporate network, outside business hours
 */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: {
    AUTOMATION_DETECTED: 70,
    INSECURE_CONTEXT: 40,
    UA_MISMATCH: 40,
    BROWSER_OUTDATED: 20,
    BROWSER_UNSUPPORTED: 15,
    OS_UNSUPPORTED: 15,
    NEW_DEVICE: 20,
    NETWORK_CHANGED: 15,
    OFF_NETWORK: 10,
    OFF_HOURS: 10,
    RECENT_FAILED_LOGINS: 20,
  },
  thresholds: { medium: 30, high: 60 },
  failedLoginThreshold: 3,
};

const POSTURE_SIGNALS: Partial<Record<PostureCheckId, RiskSignalCode>> = {
  AUTOMATION: "AUTOMATION_DETECTED",
  SECURE_CONTEXT: "INSECURE_CONTEXT",
  UA_CONSISTENT: "UA_MISMATCH",
  BROWSER_UP_TO_DATE: "BROWSER_OUTDATED",
  BROWSER_SUPPORTED: "BROWSER_UNSUPPORTED",
  OS_SUPPORTED: "OS_UNSUPPORTED",
};

export function riskLevel(score: number, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskLevel {
  if (score >= config.thresholds.high) return "high";
  if (score >= config.thresholds.medium) return "medium";
  return "low";
}

export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

export function assessRisk(input: RiskInput, config: RiskConfig = DEFAULT_RISK_CONFIG): RiskAssessment {
  const signals: RiskSignal[] = [];
  const add = (code: RiskSignalCode, description: string) =>
    signals.push({ code, weight: config.weights[code], description });

  for (const check of input.posture.checks) {
    const code = POSTURE_SIGNALS[check.id];
    if (code && !check.passed) add(code, check.detail);
  }

  if (input.device.isNew && !input.device.trusted) {
    add("NEW_DEVICE", "First session from this device");
  }
  if (input.network.ipChanged) {
    add("NETWORK_CHANGED", "IP address changed since sign-in");
  }
  if (input.network.onTrustedNetwork === false) {
    add("OFF_NETWORK", "Request is not from a trusted company network");
  }
  if (input.time.offHours) {
    add("OFF_HOURS", "Outside business hours");
  }
  if (input.recentFailedLogins >= config.failedLoginThreshold) {
    add("RECENT_FAILED_LOGINS", `${input.recentFailedLogins} failed sign-ins in the last hour`);
  }

  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  return { score, level: riskLevel(score, config), signals };
}
