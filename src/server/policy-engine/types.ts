/**
 * Access-control / policy engine contracts.
 *
 * Least privilege: every request to a protected resource is evaluated against
 * the user's roles (from Keycloak), the resource's policy, the device and the
 * current risk assessment. The default decision is DENY.
 */

import type { RiskAssessment, RiskLevel, RiskSignalCode } from "@/server/risk-engine/types";

export type Decision = "allow" | "step_up" | "deny";

export interface ResourcePolicy {
  id: string;
  /** Resource identifier used by `requireAccess(resource)`. */
  resource: string;
  description: string;
  /** The user needs at least one of these roles. */
  allowedRoles: string[];
  /** Allow without further checks up to this risk level. */
  allowUpTo: RiskLevel;
  /**
   * Up to this level, allow only if the user authenticated (password + OTP)
   * within `stepUpFreshMinutes`, otherwise require step-up. Above it: deny.
   * `null` means anything above `allowUpTo` is denied.
   */
  stepUpUpTo: RiskLevel | null;
  stepUpFreshMinutes: number;
  /** Require re-authentication when the last sign-in is older than this, whatever the risk. */
  maxAuthAgeMinutes?: number;
  /** Signals that deny access outright, regardless of score. */
  denySignals: RiskSignalCode[];
  /** Only devices an administrator marked as trusted may access the resource. */
  requireTrustedDevice?: boolean;
}

export interface AccessRequest {
  resource: string;
  roles: string[];
  risk: RiskAssessment;
  /** Minutes since the user last completed password + OTP. */
  authAgeMinutes: number;
  device: { trusted: boolean; blocked: boolean };
}

export type DecisionReason =
  | "NO_POLICY"
  | "ROLE_REQUIRED"
  | "DEVICE_BLOCKED"
  | "DEVICE_NOT_TRUSTED"
  | "DENY_SIGNAL"
  | "RISK_TOO_HIGH"
  | "REAUTH_REQUIRED"
  | "RISK_STEP_UP"
  | "STEP_UP_SATISFIED"
  | "WITHIN_RISK_TOLERANCE";

export interface PolicyDecision {
  decision: Decision;
  reason: DecisionReason;
  policyId: string | null;
  /** Human-readable explanation, safe to show to the user. */
  explanation: string;
}
