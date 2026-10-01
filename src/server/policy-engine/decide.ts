import { RISK_LEVEL_ORDER } from "@/server/risk-engine/assess";
import type { RiskLevel } from "@/server/risk-engine/types";
import { POLICIES } from "./policies";
import type { AccessRequest, PolicyDecision, ResourcePolicy } from "./types";

/**
 * Policy decision point (pure: no I/O, unit-tested in tests/policy-engine.test.ts).
 *
 * Evaluation order (first match wins):
 *   1. no policy for the resource                -> deny
 *   2. missing role (least privilege)            -> deny
 *   3. blocked / untrusted device                -> deny
 *   4. a hard-deny risk signal is present        -> deny
 *   5. risk <= allowUpTo                         -> allow (unless sign-in older than maxAuthAge -> step-up)
 *   6. risk <= stepUpUpTo                        -> allow if signed in within stepUpFreshMinutes, else step-up
 *   7. otherwise                                 -> deny
 */

const LEVEL_LABEL: Record<RiskLevel, string> = { low: "low", medium: "medium", high: "high" };

const within = (level: RiskLevel, limit: RiskLevel) => RISK_LEVEL_ORDER[level] <= RISK_LEVEL_ORDER[limit];

export function findPolicy(resource: string, policies: ResourcePolicy[] = POLICIES) {
  return policies.find((p) => p.resource === resource) ?? null;
}

export function decide(req: AccessRequest, policies: ResourcePolicy[] = POLICIES): PolicyDecision {
  const policy = findPolicy(req.resource, policies);
  if (!policy) {
    return {
      decision: "deny",
      reason: "NO_POLICY",
      policyId: null,
      explanation: "This resource has no access policy, so access is denied by default.",
    };
  }
  const result = (
    decision: PolicyDecision["decision"],
    reason: PolicyDecision["reason"],
    explanation: string,
  ): PolicyDecision => ({ decision, reason, policyId: policy.id, explanation });

  if (!req.roles.some((r) => policy.allowedRoles.includes(r))) {
    return result("deny", "ROLE_REQUIRED", "Your role does not grant access to this resource.");
  }
  if (req.device.blocked) {
    return result("deny", "DEVICE_BLOCKED", "This device has been blocked by an administrator.");
  }
  if (policy.requireTrustedDevice && !req.device.trusted) {
    return result("deny", "DEVICE_NOT_TRUSTED", "This resource is only available from devices approved by an administrator.");
  }
  const blocking = req.risk.signals.find((s) => policy.denySignals.includes(s.code));
  if (blocking) {
    return result("deny", "DENY_SIGNAL", blocking.description);
  }

  const level = req.risk.level;
  if (within(level, policy.allowUpTo)) {
    if (policy.maxAuthAgeMinutes !== undefined && req.authAgeMinutes > policy.maxAuthAgeMinutes) {
      return result(
        "step_up",
        "REAUTH_REQUIRED",
        `This resource requires a sign-in from the last ${policy.maxAuthAgeMinutes} minutes.`,
      );
    }
    return result("allow", "WITHIN_RISK_TOLERANCE", `Risk is ${LEVEL_LABEL[level]}.`);
  }

  if (policy.stepUpUpTo && within(level, policy.stepUpUpTo)) {
    if (req.authAgeMinutes <= policy.stepUpFreshMinutes) {
      return result("allow", "STEP_UP_SATISFIED", `Risk is ${LEVEL_LABEL[level]}; recent sign-in accepted.`);
    }
    return result(
      "step_up",
      "RISK_STEP_UP",
      `Risk is ${LEVEL_LABEL[level]}. Please confirm it is you by signing in again.`,
    );
  }

  return result("deny", "RISK_TOO_HIGH", `Risk is ${LEVEL_LABEL[level]}, which is above what this resource allows.`);
}
