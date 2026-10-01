import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { recordAuditEvent } from "@/server/audit/log";
import { redirectUris } from "@/server/auth/keycloak";
import { completeLogin, LOGIN_TX_COOKIE, LoginError } from "@/server/auth/login";
import { requestContext } from "@/server/request-context";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/session/cookie";
import { endSession, findSessionByCookie } from "@/server/session/store";

/** GET /api/auth/callback: Keycloak redirects here after authentication. */
export async function GET(request: NextRequest) {
  const context = requestContext(request.headers);
  const appUrl = getEnv().APP_URL;
  // Rebuild the URL from the registered redirect URI rather than trusting the Host header.
  const callbackUrl = new URL(redirectUris().callback + request.nextUrl.search);

  try {
    const login = await completeLogin(
      callbackUrl,
      request.cookies.get(LOGIN_TX_COOKIE)?.value,
      context,
    );

    // Session fixation defence: any session the browser already had is ended and replaced.
    const previous = request.cookies.get(SESSION_COOKIE)?.value;
    if (previous) {
      const old = await findSessionByCookie(previous);
      if (old) await endSession(old.session.id, "revoked", "replaced_by_new_login");
    }

    await recordAuditEvent({
      type: "auth.login.success",
      outcome: "success",
      actorUserId: login.user.id,
      sessionId: login.sessionId,
      ...context,
      metadata: { amr: login.authMethods, roles: login.user.roles },
    });

    const response = NextResponse.redirect(new URL(login.returnTo, appUrl), 303);
    response.cookies.set(SESSION_COOKIE, login.cookieValue, sessionCookieOptions());
    response.cookies.delete({ name: LOGIN_TX_COOKIE, path: "/api/auth" });
    return response;
  } catch (err) {
    const code = err instanceof LoginError ? err.code : "internal_error";
    await recordAuditEvent({
      type: "auth.login.failure",
      outcome: "failure",
      ...context,
      metadata: {
        code,
        message: (err as Error).message,
        ...(err instanceof LoginError ? err.details : {}),
      },
    });
    if (!(err instanceof LoginError)) console.error("[auth] callback failed:", err);

    const response = NextResponse.redirect(new URL(`/login?error=${code}`, appUrl), 303);
    response.cookies.delete({ name: LOGIN_TX_COOKIE, path: "/api/auth" });
    return response;
  }
}
