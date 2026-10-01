/**
 * Risk engine: contracts only (implemented in a later phase).
 *
 * Combines contextual signals into a risk score that the policy engine
 * uses to allow, step-up (require MFA again) or deny access.
 */

import type { PostureAssessment } from "@/server/device-posture/types";

export type RiskLevel = "low" | "medium" | "high";

export interface RiskContext {
  userId: string;
  ipAddress: string;
  posture: PostureAssessment;
  /** Local time of the request, used for off-hours signals. */
  requestTime: Date;
  recentFailedLogins: number;
}

export interface RiskSignal {
  code: string; // e.g. "UNKNOWN_DEVICE", "NEW_IP", "OFF_HOURS"
  weight: number;
  description: string;
}

export interface RiskAssessment {
  score: number; // 0 to 100
  level: RiskLevel;
  signals: RiskSignal[];
}
