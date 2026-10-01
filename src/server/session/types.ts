/**
 * Session management and continuous verification: contracts only (later phase).
 *
 * Tokens from Keycloak stay on the server (BFF pattern). The browser only holds
 * an opaque, HttpOnly session cookie. Each session is re-verified periodically
 * and on sensitive actions, and can be revoked by an administrator.
 */

export type SessionStatus = "active" | "step_up_required" | "revoked" | "expired";

export interface AppSession {
  id: string;
  userId: string;
  deviceId: string;
  status: SessionStatus;
  createdAt: string;
  lastVerifiedAt: string;
  expiresAt: string;
}
