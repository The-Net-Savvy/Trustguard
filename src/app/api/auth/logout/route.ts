import { NextResponse, type NextRequest } from "next/server";
import * as oidc from "openid-client";
import { getEnv } from "@/config/env";
import { recordAuditEvent } from "@/server/audit/log";
import { getOidcConfiguration, redirectUris } from "@/server/auth/keycloak";
import { requestContext } from "@/server/request-context";
import { SESSION_COOKIE } from "@/server/session/cookie";
import { endSession, findSessionByCookie, readTokens } from "@/server/session/store";

/**
 * POST /api/auth/logout
 *
 * Ends the app session, then sends the browser to Keycloak's end-session endpoint
 * so the single sign-on session is terminated too (RP-initiated logout).
 * POST + same-origin check, so another site cannot log the user out (logout CSRF).
 */
export async function POST(request: NextRequest) {
  const appUrl = getEnv().APP_URL;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(appUrl).origin) {
    return NextResponse.json({ error: "cross-origin logout rejected" }, { status: 403 });
  }

  let destination = new URL(redirectUris().postLogout);
  const cookieValue = request.cookies.get(SESSION_COOKIE)?.value;
  const loaded = cookieValue ? await findSessionByCookie(cookieValue) : null;

  if (loaded) {
    const tokens = readTokens(loaded.tokensEncrypted);
    if (await endSession(loaded.session.id, "revoked", "user_logout")) {
      await recordAuditEvent({
        type: "auth.logout",
        outcome: "success",
        actorUserId: loaded.user.id,
        sessionId: loaded.session.id,
        ...requestContext(request.headers),
      });
    }
    try {
      const config = await getOidcConfiguration();
      destination = oidc.buildEndSessionUrl(config, {
        post_logout_redirect_uri: redirectUris().postLogout,
        ...(tokens?.idToken ? { id_token_hint: tokens.idToken } : {}),
      });
    } catch (err) {
      // Keycloak unreachable: the app session is already gone; skip IdP logout.
      console.error("[auth] could not build end-session URL:", (err as Error).message);
    }
  }

  const response = NextResponse.redirect(destination, 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
