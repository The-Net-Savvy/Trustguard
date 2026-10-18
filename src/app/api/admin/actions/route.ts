import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { evaluateAccess } from "@/server/access/require-access";
import { performAdminAction } from "@/server/admin/actions";
import { parseAdminAction } from "@/server/admin/types";
import { recordAuditEvent } from "@/server/audit/log";
import { safeReturnTo } from "@/server/auth/login";
import { requestContext } from "@/server/request-context";

/**
 * POST /api/admin/actions: perform an administrative action (plain HTML form post).
 *
 * Protections: same-origin check (CSRF; the session cookie is also SameSite=Lax),
 * the `admin.manage` policy (admin role, low risk or a very recent sign-in), strict
 * input parsing, and an audit record for every attempt that reaches the action.
 */
export async function POST(request: NextRequest) {
  const appUrl = getEnv().APP_URL;
  if (request.headers.get("origin") !== new URL(appUrl).origin) {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const rawReturn = safeReturnTo(form?.get("returnTo")?.toString());
  const returnTo = rawReturn.startsWith("/admin") ? rawReturn.split("?")[0] : "/admin";
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(new URL(`${returnTo}?${new URLSearchParams(params)}`, appUrl), 303);

  const evaluation = await evaluateAccess("admin.manage", returnTo);
  if (evaluation.kind === "redirect") return NextResponse.redirect(new URL(evaluation.to, appUrl), 303);
  const { decision } = evaluation.ctx;
  if (decision.decision === "step_up") {
    return NextResponse.redirect(
      new URL(`/login?returnTo=${encodeURIComponent(returnTo)}&reason=step_up`, appUrl),
      303,
    );
  }
  if (decision.decision === "deny") {
    return NextResponse.redirect(
      new URL(`/access-denied?resource=admin.manage&returnTo=${encodeURIComponent(returnTo)}`, appUrl),
      303,
    );
  }

  const action = parseAdminAction(form?.get("action"), form?.get("target"));
  if (!action) {
    // A malformed admin request (tampered form or script) is itself security-relevant.
    await recordAuditEvent({
      type: "admin.action",
      outcome: "failure",
      actorUserId: evaluation.ctx.user.id,
      sessionId: evaluation.ctx.session.id,
      ...requestContext(request.headers),
      resource: "admin.manage",
      metadata: {
        action: String(form?.get("action") ?? "").slice(0, 64),
        target: String(form?.get("target") ?? "").slice(0, 64),
        error: "invalid_request",
      },
    });
    return back({ error: "invalid_request" });
  }

  const result = await performAdminAction(evaluation.ctx, action, requestContext(request.headers));
  if (!result.ok) return back({ error: result.error });
  return back(result.idpSynced ? { notice: result.notice } : { notice: result.notice, warning: "idp_not_synced" });
}
