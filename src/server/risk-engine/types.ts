/**
 * Risk engine contracts.
 *
 * Contextual signals are combined into a 0-100 risk score that the policy engine
 * uses to allow, step-up (re-authenticate) or deny access.
 */

import type { PostureAssessment } from "@/server/device-posture/types";

export type RiskLevel = "low" | "medium" | "high";

export type RiskSignalCode =
  | "AUTOMATION_DETECTED"
  | "INSECURE_CONTEXT"
  | "UA_MISMATCH"
  | "BROWSER_OUTDATED"
  | "BROWSER_UNSUPPORTED"
  | "OS_UNSUPPORTED"
  | "NEW_DEVICE"
  | "NETWORK_CHANGED"
  | "OFF_NETWORK"
  | "OFF_HOURS"
  | "RECENT_FAILED_LOGINS";

export interface RiskInput {
  posture: PostureAssessment;
  device: { isNew: boolean; trusted: boolean };
  network: { ipChanged: boolean; onTrustedNetwork: boolean | null };
  time: { offHours: boolean };
  recentFailedLogins: number;
}

export interface RiskSignal {
  code: RiskSignalCode;
  weight: number;
  description: string;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  signals: RiskSignal[];
}

export interface RiskConfig {
  weights: Record<RiskSignalCode, number>;
  /** Score at or above which the level is medium / high. */
  thresholds: { medium: number; high: number };
  /** Failed logins within the last hour at or above which RECENT_FAILED_LOGINS fires. */
  failedLoginThreshold: number;
}
