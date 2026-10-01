/**
 * Audit logging contracts.
 *
 * Every security-relevant event is written append-only to `trustguard.audit_events`
 * so administrators can review authentication and access decisions.
 */

export type AuditEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "auth.mfa.step_up"
  | "session.expired"
  | "session.revoked"
  | "device.posture.evaluated"
  | "access.decision"
  | "admin.action";

export type AuditOutcome = "success" | "failure" | "allow" | "step_up" | "deny";

export interface AuditEvent {
  type: AuditEventType;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  sessionId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  resource?: string;
  metadata?: Record<string, unknown>;
}
