import { NextResponse, type NextRequest } from "next/server";
import { recordAuditEvent } from "@/server/audit/log";
import { verifyLogoutToken } from "@/server/auth/backchannel";
import { revokeByIdpSession, revokeByKeycloakSub } from "@/server/session/store";

/**
 * POST /api/auth/backchannel-logout (OIDC Back-Channel Logout 1.0)
 *
 * Keycloak calls this server-to-server when an IdP session ends: the user logged out
 * in another app, an administrator terminated the session, or the account was disabled.
 * The matching app sessions are revoked immediately, so access is cut off on the
 * user's next request instead of when the access token expires.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null);
  const logoutToken = form?.get("logout_token");
  if (typeof logoutToken !== "string") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const claims = await verifyLogoutToken(logoutToken);
  if (!claims) {
    await recordAuditEvent({
      type: "session.revoked",
      outcome: "failure",
      metadata: { reason: "backchannel_logout_token_invalid" },
    });
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const revoked = claims.sid
    ? await revokeByIdpSession(claims.sid, "idp_backchannel_logout")
    : await revokeByKeycloakSub(claims.sub!, "idp_backchannel_logout");

  for (const s of revoked) {
    await recordAuditEvent({
      type: "session.revoked",
      outcome: "deny",
      actorUserId: s.user_id,
      sessionId: s.id,
      metadata: { reason: "idp_backchannel_logout", sid: claims.sid ?? null },
    });
  }

  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
