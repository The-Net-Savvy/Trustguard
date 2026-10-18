import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getKeycloakConfig } from "./keycloak";

/**
 * Validation of OIDC Back-Channel Logout tokens (spec section 2.6):
 * signature (realm JWKS), issuer, audience, freshness, the back-channel logout
 * event, a `sid` or `sub`, and no `nonce`.
 */

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

export interface LogoutTokenClaims {
  sub?: string;
  sid?: string;
}

export async function verifyLogoutToken(token: string): Promise<LogoutTokenClaims | null> {
  const kc = getKeycloakConfig();
  if (!kc) return null;
  jwks ??= createRemoteJWKSet(new URL(kc.endpoints.jwks));

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: kc.issuer,
      audience: kc.clientId,
      maxTokenAge: "5m",
      // The app server and Keycloak clocks are never perfectly in sync (on Windows the
      // Docker VM clock and the host clock routinely drift by tens of seconds).
      clockTolerance: 60,
      requiredClaims: ["iat", "jti", "events"],
    });
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || typeof events !== "object" || !(BACKCHANNEL_EVENT in events)) return null;
    if ("nonce" in payload) return null;

    const sid = typeof payload.sid === "string" ? payload.sid : undefined;
    const sub = typeof payload.sub === "string" ? payload.sub : undefined;
    if (!sid && !sub) return null;
    return { sid, sub };
  } catch (err) {
    console.error("[auth] invalid back-channel logout token:", (err as Error).message);
    return null;
  }
}
