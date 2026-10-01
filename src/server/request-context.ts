import "server-only";

export interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

/**
 * Client IP and user agent for audit and session records.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy you control; the
 * prototype runs directly on localhost, so the first hop is taken as-is.
 */
export function requestContext(headers: Headers): RequestContext {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip") || null;
  return {
    ipAddress: ip && isIp(ip) ? normaliseIp(ip) : null,
    userAgent: headers.get("user-agent")?.slice(0, 512) ?? null,
  };
}

function isIp(value: string): boolean {
  return /^[0-9a-fA-F:.]+$/.test(value);
}

/** Strip the IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 -> 127.0.0.1). */
function normaliseIp(ip: string): string {
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}
