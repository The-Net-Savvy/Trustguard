import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection.
 *
 * Proxy only checks that a session cookie is present and redirects to the login
 * page otherwise. It deliberately does no database work; the authoritative check
 * (`requireSession` in src/server/session/current.ts) runs in every protected
 * page and route handler.
 */

const SESSION_COOKIE = "tg_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*"],
};
