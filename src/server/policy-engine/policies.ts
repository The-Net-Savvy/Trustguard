import type { ResourcePolicy } from "./types";

/**
 * Access policies (policy as code).
 *
 * Each protected resource has exactly one policy. A resource without a policy is
 * denied. Roles come from Keycloak realm roles; `tg-admin` is a composite role
 * that includes `tg-employee`.
 */
export const POLICIES: ResourcePolicy[] = [
  {
    id: "dashboard.view.v1",
    resource: "dashboard",
    description: "Employee dashboard: everyday work for any employee on a reasonably healthy device",
    allowedRoles: ["tg-employee"],
    allowUpTo: "medium",
    stepUpUpTo: null,
    stepUpFreshMinutes: 0,
    denySignals: ["AUTOMATION_DETECTED", "UA_MISMATCH"],
  },
  {
    id: "admin.console.v1",
    resource: "admin.console",
    description:
      "Administrative console: administrators only, low risk, or medium risk with a sign-in from the last 10 minutes",
    allowedRoles: ["tg-admin"],
    allowUpTo: "low",
    stepUpUpTo: "medium",
    stepUpFreshMinutes: 10,
    maxAuthAgeMinutes: 60,
    denySignals: ["AUTOMATION_DETECTED", "UA_MISMATCH", "INSECURE_CONTEXT"],
  },
  {
    id: "admin.manage.v1",
    resource: "admin.manage",
    description:
      "Administrative actions (revoke sessions, suspend users, trust/block devices): administrators only, " +
      "low risk or medium risk with a sign-in from the last 10 minutes, and never with a sign-in older than 30 minutes",
    allowedRoles: ["tg-admin"],
    allowUpTo: "low",
    stepUpUpTo: "medium",
    stepUpFreshMinutes: 10,
    maxAuthAgeMinutes: 30,
    denySignals: ["AUTOMATION_DETECTED", "UA_MISMATCH", "INSECURE_CONTEXT", "RECENT_FAILED_LOGINS"],
  },
];
