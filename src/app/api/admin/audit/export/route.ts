import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { evaluateAccess } from "@/server/access/require-access";
import { toCsv } from "@/server/admin/csv";
import { cleanAuditFilters } from "@/server/admin/filters";
import { queryAudit } from "@/server/admin/queries";
import { recordAuditEvent } from "@/server/audit/log";
import { requestContext } from "@/server/request-context";

/**
 * GET /api/admin/audit/export?type=&outcome=&user=&from=&to=: the filtered audit
 * log as CSV (max 10,000 rows). Requires the `admin.console` policy; the export
 * itself is audited, since it moves security data out of the system.
 */
export async function GET(request: NextRequest) {
  const appUrl = getEnv().APP_URL;
  const evaluation = await evaluateAccess("admin.console", "/admin/audit");
  if (evaluation.kind === "redirect") return NextResponse.redirect(new URL(evaluation.to, appUrl), 303);
  if (evaluation.ctx.decision.decision !== "allow") {
    return NextResponse.json({ error: "forbidden", reason: evaluation.ctx.decision.reason }, { status: 403 });
  }

  const filters = cleanAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
  const rows = await queryAudit(filters, 10_000);
  await recordAuditEvent({
    type: "admin.action",
    outcome: "success",
    actorUserId: evaluation.ctx.user.id,
    sessionId: evaluation.ctx.session.id,
    ...requestContext(request.headers),
    resource: "admin.console",
    metadata: { action: "export_audit", filters, rows: rows.length },
  });

  const csv = toCsv(
    ["id", "occurred_at", "event_type", "outcome", "user", "resource", "ip_address", "user_agent", "metadata"],
    rows.map((r) => [r.id, r.occurred_at, r.event_type, r.outcome, r.username, r.resource, r.ip_address, r.user_agent, r.metadata]),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trust-guard-audit-${stamp}.csv"`,
      "cache-control": "no-store",
    },
  });
}
