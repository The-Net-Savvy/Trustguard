import "server-only";
import { getEnv } from "@/config/env";

export const SESSION_COOKIE = "tg_session";

/**
 * Session cookie attributes: HttpOnly (no JS access), SameSite=Lax (not sent on
 * cross-site sub-requests or POSTs), Secure whenever the app is served over HTTPS.
 * Its lifetime matches the session's absolute timeout; the server is still the
 * authority on whether the session is valid.
 */
export function sessionCookieOptions() {
  const env = getEnv();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.APP_URL.startsWith("https://"),
    path: "/",
    maxAge: env.SESSION_ABSOLUTE_TIMEOUT_HOURS * 3600,
  };
}
