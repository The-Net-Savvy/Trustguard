import "server-only";
import { getEnv } from "@/config/env";
import { query } from "@/server/db/client";
import type { RequestContext } from "@/server/request-context";
import { decrypt, encrypt, hashSessionId, newSessionId } from "./crypto";
import type { DevicePostureReport } from "@/server/device-posture/types";
import type { AppSession, AuthenticatedSession, SessionUser, StoredTokens } from "./types";

/** Data access for `trustguard.users` and `trustguard.sessions`. */

interface UserRow {
  user_id: string;
  keycloak_sub: string;
  username: string;
  email: string | null;
  display_name: string | null;
  roles: string[];
}

interface SessionRow extends UserRow {
  id: string;
  status: AppSession["status"];
  idp_session_id: string | null;
  auth_methods: string[];
  access_expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
  last_verified_at: Date;
  absolute_expires_at: Date;
  tokens_encrypted: string;
  ip_address: string | null;
  device_id: string | null;
  posture: AppSession["posture"];
  posture_at: Date | null;
  last_access: Record<string, string>;
}

function toSession(r: SessionRow): AppSession {
  return {
    id: r.id,
    userId: r.user_id,
    status: r.status,
    idpSessionId: r.idp_session_id,
    authMethods: r.auth_methods,
    accessExpiresAt: r.access_expires_at,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    lastVerifiedAt: r.last_verified_at,
    absoluteExpiresAt: r.absolute_expires_at,
    ipAddress: r.ip_address,
    deviceId: r.device_id,
    posture: r.posture,
    postureAt: r.posture_at,
    lastAccess: r.last_access,
  };
}

function toUser(r: UserRow): SessionUser {
  return {
    id: r.user_id,
    keycloakSub: r.keycloak_sub,
    username: r.username,
    email: r.email,
    displayName: r.display_name,
    roles: r.roles,
  };
}

export interface IdentityClaims {
  sub: string;
  username: string;
  email?: string | null;
  displayName?: string | null;
  roles: string[];
}

/** Create or update the local projection of a Keycloak user (just-in-time provisioning). */
export async function upsertUser(identity: IdentityClaims): Promise<SessionUser> {
  const { rows } = await query<UserRow>(
    `insert into trustguard.users (keycloak_sub, username, email, display_name, roles, last_login_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (keycloak_sub) do update set
       username = excluded.username,
       email = excluded.email,
       display_name = excluded.display_name,
       roles = excluded.roles,
       last_login_at = now()
     returning id as user_id, keycloak_sub, username, email, display_name, roles`,
    [identity.sub, identity.username, identity.email ?? null, identity.displayName ?? null, identity.roles],
  );
  return toUser(rows[0]);
}

export interface NewSessionInput {
  userId: string;
  tokens: StoredTokens;
  accessExpiresAt: Date;
  idpSessionId: string | null;
  authMethods: string[];
  context: RequestContext;
}

/** Create a session. Returns the raw session id, which only ever goes into the cookie. */
export async function createSession(
  input: NewSessionInput,
): Promise<{ cookieValue: string; sessionId: string }> {
  const cookieValue = newSessionId();
  const { rows } = await query<{ id: string }>(
    `insert into trustguard.sessions
       (id_hash, user_id, idp_session_id, auth_methods, tokens_encrypted, access_expires_at,
        ip_address, user_agent, absolute_expires_at)
     values ($1, $2, $3, $4, $5, $6, $7::inet, $8, now() + make_interval(hours => $9))
     returning id`,
    [
      hashSessionId(cookieValue),
      input.userId,
      input.idpSessionId,
      input.authMethods,
      encrypt(JSON.stringify(input.tokens), "tokens"),
      input.accessExpiresAt,
      input.context.ipAddress,
      input.context.userAgent,
      getEnv().SESSION_ABSOLUTE_TIMEOUT_HOURS,
    ],
  );
  return { cookieValue, sessionId: rows[0].id };
}

export interface LoadedSession extends AuthenticatedSession {
  tokensEncrypted: string;
}

/** Look up a session (any status) by the raw cookie value. */
export async function findSessionByCookie(cookieValue: string): Promise<LoadedSession | null> {
  const { rows } = await query<SessionRow>(
    `select s.id, s.user_id, s.status, s.idp_session_id, s.auth_methods, s.access_expires_at,
            s.created_at, s.last_seen_at, s.last_verified_at, s.absolute_expires_at,
            s.tokens_encrypted, host(s.ip_address) as ip_address, s.device_id, s.posture,
            s.posture_at, s.last_access, u.keycloak_sub, u.username, u.email, u.display_name, u.roles
       from trustguard.sessions s
       join trustguard.users u on u.id = s.user_id
      where s.id_hash = $1`,
    [hashSessionId(cookieValue)],
  );
  const r = rows[0];
  return r ? { session: toSession(r), user: toUser(r), tokensEncrypted: r.tokens_encrypted } : null;
}

export function readTokens(tokensEncrypted: string): StoredTokens | null {
  const json = decrypt(tokensEncrypted, "tokens");
  return json ? (JSON.parse(json) as StoredTokens) : null;
}

/** Sliding idle timeout: record activity. */
export async function touchSession(sessionId: string): Promise<void> {
  await query(
    `update trustguard.sessions set last_seen_at = now() where id = $1 and status = 'active'`,
    [sessionId],
  );
}

/** Store refreshed tokens after Keycloak re-confirmed that the session is still valid. */
export async function saveRefreshedTokens(
  sessionId: string,
  userId: string,
  tokens: StoredTokens,
  accessExpiresAt: Date,
  roles: string[] | null,
): Promise<void> {
  await query(
    `update trustguard.sessions
        set tokens_encrypted = $2, access_expires_at = $3,
            last_verified_at = now(), last_seen_at = now()
      where id = $1 and status = 'active'`,
    [sessionId, encrypt(JSON.stringify(tokens), "tokens"), accessExpiresAt],
  );
  // Role changes made in Keycloak take effect at the next refresh.
  if (roles) {
    await query(`update trustguard.users set roles = $2 where id = $1`, [userId, roles]);
  }
}

/** End a session. Returns true if it was still active. */
export async function endSession(
  sessionId: string,
  status: "revoked" | "expired",
  reason: string,
): Promise<boolean> {
  const { rowCount } = await query(
    `update trustguard.sessions
        set status = $2, revoked_at = now(), revoked_reason = $3
      where id = $1 and status = 'active'`,
    [sessionId, status, reason],
  );
  return (rowCount ?? 0) > 0;
}

/** Revoke every active app session bound to a Keycloak session (`sid`). */
export async function revokeByIdpSession(
  idpSessionId: string,
  reason: string,
): Promise<{ id: string; user_id: string }[]> {
  const { rows } = await query<{ id: string; user_id: string }>(
    `update trustguard.sessions
        set status = 'revoked', revoked_at = now(), revoked_reason = $2
      where idp_session_id = $1 and status = 'active'
      returning id, user_id`,
    [idpSessionId, reason],
  );
  return rows;
}

/** Revoke every active session of the user with the given Keycloak `sub`. */
export async function revokeByKeycloakSub(
  sub: string,
  reason: string,
): Promise<{ id: string; user_id: string }[]> {
  const { rows } = await query<{ id: string; user_id: string }>(
    `update trustguard.sessions s
        set status = 'revoked', revoked_at = now(), revoked_reason = $2
       from trustguard.users u
      where u.id = s.user_id and u.keycloak_sub = $1 and s.status = 'active'
      returning s.id, s.user_id`,
    [sub, reason],
  );
  return rows;
}

/**
 * Bind the session to its device (first report wins, atomically) and store the
 * latest posture. Returns false, without saving, if the session is bound to a
 * different device.
 */
export async function savePosture(
  sessionId: string,
  deviceId: string,
  posture: DevicePostureReport,
): Promise<boolean> {
  const { rowCount } = await query(
    `update trustguard.sessions
        set device_id = coalesce(device_id, $2), posture = $3, posture_at = now()
      where id = $1 and status = 'active' and (device_id is null or device_id = $2)`,
    [sessionId, deviceId, JSON.stringify(posture)],
  );
  return (rowCount ?? 0) > 0;
}

/** Remember the latest decision for a resource (drives audit de-duplication). */
export async function recordAccess(sessionId: string, resource: string, key: string): Promise<void> {
  await query(
    `update trustguard.sessions
        set last_access = last_access || jsonb_build_object($2::text, $3::text)
      where id = $1`,
    [sessionId, resource, key],
  );
}
