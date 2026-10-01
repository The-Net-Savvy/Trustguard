import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection.
 *
 * Proxy only checks that a session cookie is present and redirects to the login
 * page otherwise. It deliberately does no database work; the authoritative check
 * (`requireAccess` in src/server/access/require-access.ts) runs in every protected
 * page. Proxy also forwards the requested path (with query) in `x-tg-path`, so
 * redirects to login / device verification can return the user exactly there.
 */

const SESSION_COOKIE = "tg_session";
export const PATH_HEADER = "x-tg-path";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname + request.nextUrl.search;

  if (!request.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("returnTo", path);
    return NextResponse.redirect(login);
  }

  // Overwrite any client-supplied value.
  const headers = new Headers(request.headers);
  headers.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/verify-device", "/access-denied"],
};
