import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import * as oidc from "openid-client";
import { getEnv } from "@/config/env";
import { recordAuditEvent } from "@/server/audit/log";
import { getOidcConfiguration } from "@/server/auth/keycloak";
import { rolesFromClaims } from "@/server/auth/login";
import { SESSION_COOKIE } from "./cookie";
import {
  endSession,
  findSessionByCookie,
  readTokens,
  saveRefreshedTokens,
  touchSession,
  type LoadedSession,
} from "./store";
import type { AuthenticatedSession } from "./types";

/**
 * Session verification (the "Data Access Layer" check).
 *
 * Proxy only does an optimistic cookie-presence check; this is the authoritative
 * check, called by every protected page, route handler and server action:
 *
 *  - the session must exist and be `active` (not logged out / revoked by an admin),
 *  - it must be within its absolute lifetime and idle timeout,
 *  - when the Keycloak access token is about to expire it is refreshed, which makes
 *    Keycloak re-confirm the user's IdP session is still valid (continuous verification).
 *    If Keycloak refuses, the app session is revoked immediately.
 */

const REFRESH_LEEWAY_MS = 30_000;
const TOUCH_INTERVAL_MS = 60_000;

async function expire(loaded: LoadedSession, reason: string) {
  if (await endSession(loaded.session.id, "expired", reason)) {
    await recordAuditEvent({
      type: "session.expired",
      outcome: "deny",
      actorUserId: loaded.user.id,
      sessionId: loaded.session.id,
      metadata: { reason },
    });
  }
}

async function revoke(loaded: LoadedSession, reason: string, metadata: Record<string, unknown> = {}) {
  if (await endSession(loaded.session.id, "revoked", reason)) {
    await recordAuditEvent({
      type: "session.revoked",
      outcome: "deny",
      actorUserId: loaded.user.id,
      sessionId: loaded.session.id,
      metadata: { reason, ...metadata },
    });
  }
}

/** Re-verify with Keycloak by refreshing the tokens. Returns false if the session must end. */
async function refreshWithIdp(loaded: LoadedSession): Promise<boolean> {
  const tokens = readTokens(loaded.tokensEncrypted);
  if (!tokens?.refreshToken) {
    await revoke(loaded, "refresh_token_unavailable");
    return false;
  }
  try {
    const config = await getOidcConfiguration();
    const refreshed = await oidc.refreshTokenGrant(config, tokens.refreshToken);
    const claims = refreshed.claims();
    const accessExpiresAt = new Date(Date.now() + (refreshed.expiresIn() ?? 60) * 1000);
    await saveRefreshedTokens(
      loaded.session.id,
      loaded.user.id,
      {
        accessToken: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
        idToken: refreshed.id_token ?? tokens.idToken,
      },
      accessExpiresAt,
      claims ? rolesFromClaims(claims) : null,
    );
    if (claims) loaded.user.roles = rolesFromClaims(claims);
    loaded.session.accessExpiresAt = accessExpiresAt;
    loaded.session.lastVerifiedAt = new Date();
    return true;
  } catch (err) {
    if (err instanceof oidc.ResponseBodyError) {
      // Keycloak rejected the refresh (session ended, user disabled, logged out elsewhere...).
      await revoke(loaded, "idp_session_invalid", { error: err.error });
    } else {
      // Keycloak unreachable: fail closed for this request without revoking the session.
      console.error("[session] token refresh failed:", (err as Error).message);
    }
    return false;
  }
}

/** The verified session for the current request, or `null`. Memoised per render pass. */
export const getCurrentSession = cache(async (): Promise<AuthenticatedSession | null> => {
  const cookieValue = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookieValue) return null;

  const loaded = await findSessionByCookie(cookieValue);
  if (!loaded || loaded.session.status !== "active") return null;

  const env = getEnv();
  const now = Date.now();

  if (now >= loaded.session.absoluteExpiresAt.getTime()) {
    await expire(loaded, "absolute_timeout");
    return null;
  }
  if (now - loaded.session.lastSeenAt.getTime() > env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000) {
    await expire(loaded, "idle_timeout");
    return null;
  }

  if (loaded.session.accessExpiresAt.getTime() - now < REFRESH_LEEWAY_MS) {
    if (!(await refreshWithIdp(loaded))) return null;
  } else if (now - loaded.session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await touchSession(loaded.session.id);
  }

  return { session: loaded.session, user: loaded.user };
});

/** Use in protected pages: redirects to the login page when there is no valid session. */
export async function requireSession(returnTo?: string): Promise<AuthenticatedSession> {
  const current = await getCurrentSession();
  if (!current) {
    redirect(returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login");
  }
  return current;
}

export function hasRole(current: AuthenticatedSession, role: string): boolean {
  return current.user.roles.includes(role);
}
