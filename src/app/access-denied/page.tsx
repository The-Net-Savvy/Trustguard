import Link from "next/link";
import { redirect } from "next/navigation";
import { RiskPanel } from "@/components/access/RiskPanel";
import { LogoutButton } from "@/components/auth/LogoutButton";
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
  const { decision, risk, posture } = result.ctx;
  if (decision.decision !== "deny") redirect(returnTo);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Access denied</h1>
      <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {decision.explanation} {ADVICE[decision.reason] ?? ""}
      </p>
      <p className="mt-2 text-xs text-slate-500">
        Resource <code>{resource}</code> · policy <code>{decision.policyId ?? "none"}</code> · reason{" "}
        <code>{decision.reason}</code>. This decision was recorded in the audit log.
      </p>

      <section className="mt-8">
        <RiskPanel risk={risk} posture={posture} />
      </section>

      <div className="mt-8 flex gap-2">
        {returnTo !== "/dashboard" && (
          <Link
            href="/dashboard"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Back to dashboard
          </Link>
        )}
        <LogoutButton />
      </div>
    </main>
  );
}
