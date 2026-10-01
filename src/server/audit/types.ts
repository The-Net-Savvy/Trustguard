/**
 * Audit logging: contracts only (implemented in a later phase).
 *
 * Every security-relevant event is written append-only to the database
 * so administrators can review authentication and access decisions.
 */

export type AuditEventType =
  | "auth.login.success"
  | "auth.login.failure"
  | "auth.logout"
  | "auth.mfa.step_up"
  | "device.posture.evaluated"
  | "access.decision"
  | "session.revoked"
  | "admin.action";

export interface AuditEvent {
  type: AuditEventType;
  actorUserId?: string;
  sessionId?: string;
  ipAddress?: string;
  resource?: string;
  outcome: "success" | "failure" | "allow" | "step_up" | "deny";
  metadata?: Record<string, unknown>;
}
