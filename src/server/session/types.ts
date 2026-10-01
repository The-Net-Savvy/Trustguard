/**
 * Session management contracts.
 *
 * Tokens from Keycloak stay on the server (BFF pattern). The browser only holds
 * an opaque, HttpOnly session cookie whose SHA-256 hash identifies the row in
 * `trustguard.sessions`. Sessions have a sliding idle timeout and an absolute
 * lifetime, are re-verified against Keycloak whenever the access token is
 * refreshed, and can be revoked (logout, back-channel logout, administrator).
 */

export type SessionStatus = "active" | "revoked" | "expired";

export interface SessionUser {
  id: string;
  keycloakSub: string;
  username: string;
  email: string | null;
  displayName: string | null;
  roles: string[];
}

export interface AppSession {
  id: string;
  userId: string;
  status: SessionStatus;
  idpSessionId: string | null;
  authMethods: string[];
  accessExpiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date;
  lastVerifiedAt: Date;
  absoluteExpiresAt: Date;
}

/** Keycloak tokens, stored encrypted in the session row. Never sent to the browser. */
export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
}

export interface AuthenticatedSession {
  session: AppSession;
  user: SessionUser;
}
