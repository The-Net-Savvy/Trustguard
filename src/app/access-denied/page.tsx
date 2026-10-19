import Link from "next/link";
import { ShieldX } from "lucide-react";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { SECONDARY_BUTTON } from "@/components/shell/AuthFrame";
import { redirect } from "next/navigation";
import { RiskPanel } from "@/components/access/RiskPanel";
import { evaluateAccess } from "@/server/access/require-access";
import { safeReturnTo } from "@/server/auth/login";

export const metadata = { title: "Access denied · Trust Guard" };

const ADVICE: Partial<Record<string, string>> = {
  ROLE_REQUIRED: "Ask an administrator if you need this access.",
  DEVICE_BLOCKED: "Contact your administrator. Use a different, approved device in the meantime.",
  DEVICE_NOT_TRUSTED: "Ask an administrator to approve this device.",
  DENY_SIGNAL: "Use a normal browser session on your own device and try again.",
  RISK_TOO_HIGH: "Fix the failed device checks below (for example, update your browser) and try again.",
  NO_POLICY: "This resource is not available.",
};

export default async function AccessDeniedPage({ searchParams }: PageProps<"/access-denied">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const resource = one(params.resource) ?? "";
  const returnTo = safeReturnTo(one(params.returnTo));

  // Re-evaluate (without auditing again) to explain the decision to the user.
  const result = await evaluateAccess(resource, returnTo, { audit: false });
  if (result.kind === "redirect") redirect(result.to);
  const { decision, risk, posture, user } = result.ctx;
  if (decision.decision !== "deny") redirect(returnTo);

  return (
    <AppShell user={user} active="">
      <PageHeader
        title="Access denied"
        subtitle="Trust Guard checked this request and the policy does not allow it right now."
      />
      <div role="alert" className="mb-4 flex items-start gap-3 rounded-3xl bg-rose-50 p-5 text-rose-900 ring-1 ring-rose-200">
        <ShieldX className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">
            {decision.explanation} {ADVICE[decision.reason] ?? ""}
          </p>
          <p className="mt-1 text-xs text-rose-800/80">
            Resource <code>{resource}</code> · policy <code>{decision.policyId ?? "none"}</code> · reason{" "}
            <code>{decision.reason}</code>. This decision was recorded in the audit log.
          </p>
        </div>
      </div>

      <RiskPanel risk={risk} posture={posture} />

      <div className="mt-6 flex flex-wrap gap-2">
        {returnTo !== "/dashboard" && (
          <Link href="/dashboard" className={SECONDARY_BUTTON}>
            Back to my security
          </Link>
        )}
        <form action="/api/auth/logout" method="post">
          <button type="submit" className={SECONDARY_BUTTON}>
            Sign out
          </button>
        </form>
      </div>
    </AppShell>
  );
}
