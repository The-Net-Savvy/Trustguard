import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { LOGIN_TX_COOKIE, loginTransactionCookieOptions, startLogin } from "@/server/auth/login";

/**
 * GET /api/auth/login?returnTo=/path[&reauth=1]: begin the OIDC login with Keycloak.
 * `reauth=1` forces a full re-authentication (password + one-time code).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const { authorizationUrl, transactionCookie } = await startLogin(
      params.get("returnTo") ?? "/dashboard",
      { forceReauth: params.get("reauth") === "1" },
    );
    const response = NextResponse.redirect(authorizationUrl, 303);
    response.cookies.set(LOGIN_TX_COOKIE, transactionCookie, loginTransactionCookieOptions());
    return response;
  } catch (err) {
    console.error("[auth] could not start login:", (err as Error).message);
    return NextResponse.redirect(new URL("/login?error=idp_unavailable", getEnv().APP_URL), 303);
  }
}
