import "server-only";
import { evaluateAccess, requireAccess } from "@/server/access/require-access";

/**
 * Every admin page needs `admin.console` to view. It also evaluates `admin.manage`
 * (without auditing) so the page can disable action buttons and explain a step-up
 * before the admin tries an action.
 */
export async function adminPageContext(path: string) {
  const ctx = await requireAccess("admin.console", path);
  const manage = await evaluateAccess("admin.manage", path, { audit: false });
  const manageDecision = manage.kind === "evaluated" ? manage.ctx.decision : null;
  return { ctx, manage: manageDecision, canManage: manageDecision?.decision === "allow" };
}
