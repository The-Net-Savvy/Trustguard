/**
 * Access-control / policy engine: contracts only (implemented in a later phase).
 *
 * Least privilege: every request to a protected resource is evaluated against
 * the user's roles (from Keycloak), the resource's required permission and the
 * current risk assessment. The default decision is DENY.
 */

import type { RiskAssessment } from "@/server/risk-engine/types";

export type Decision = "allow" | "step_up" | "deny";

export interface AccessRequest {
  userId: string;
  roles: string[];
  resource: string; // e.g. "finance-reports"
  action: string; // e.g. "read"
  risk: RiskAssessment;
}

export interface PolicyDecision {
  decision: Decision;
  reason: string;
  policyId?: string;
}
