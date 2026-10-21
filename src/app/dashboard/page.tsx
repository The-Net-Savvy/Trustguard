import { RiskPanel } from "@/components/access/RiskPanel";
import { PostureHeartbeat } from "@/components/device/PostureHeartbeat";
import { AppShell, PageHeader } from "@/components/shell/AppShell";
import { Card, CardTitle, Pill, StatCard, type Tone } from "@/components/ui/cards";
import { requireAccess } from "@/server/access/require-access";
import { hasSecondFactor } from "@/server/auth/login";

export const metadata = { title: "My security · Trust Guard" };

const ROLE_LABELS: Record<string, string> = {
  "tg-admin": "Administrator",
  "tg-employee": "Employee",
};

const DEVICE_STATUS: Record<string, { text: string; pill: string; tone: Tone }> = {
  registered: { text: "Registered (not yet approved)", pill: "Registered", tone: "neutral" },
  trusted: { text: "Trusted by an administrator", pill: "Trusted", tone: "good" },
  blocked: { text: "Blocked", pill: "Blocked", tone: "bad" },
};

const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dateTime = (d: Date) => d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function DashboardPage() {
  const { user, session, device, posture, risk, decision } = await requireAccess("dashboard", "/dashboard");
  const firstName = (user.displayName ?? user.username).split(/[\s.]+/)[0];
  const deviceStatus = DEVICE_STATUS[device.status];
  const mfa = hasSecondFactor(session.authMethods);

  const account: [string, string][] = [
    ["Username", user.username],
    ["Email", user.email ?? "—"],
    ["Roles", user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "None"],
    ["Signed in", dateTime(session.createdAt)],
    ["Last verified with Keycloak", dateTime(session.lastVerifiedAt)],
    ["Device first seen", dateTime(device.firstSeenAt)],
  ];

  return (
    <AppShell user={user} active="/dashboard">
      <PostureHeartbeat />
      <PageHeader
        title={`Hello, ${firstName}!`}
        subtitle="Here is the security status of this session. It is checked again on every request."
        aside={
          <Pill tone={decision.decision === "allow" ? "good" : "warn"}>
            Access allowed · {decision.explanation}
          </Pill>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          highlight
          label="Risk score"
          value={<>{risk.score}<span className="text-lg font-semibold text-white/70">/100</span></>}
          pill={<span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{risk.level} risk</span>}
          sub={`${risk.signals.length} signal${risk.signals.length === 1 ? "" : "s"} on this request`}
        />
        <StatCard
          label="This device"
          value={<span className="text-xl">{posture.label}</span>}
          pill={<Pill tone={deviceStatus.tone}>{deviceStatus.pill}</Pill>}
          sub={deviceStatus.text}
        />
        <StatCard
          label="Sign-in"
          value={<span className="text-xl">{mfa ? "Password + code" : "Password only"}</span>}
          pill={<Pill tone={mfa ? "good" : "bad"}>{mfa ? "MFA verified" : "No second factor"}</Pill>}
          sub={`Methods: ${session.authMethods.join(" + ") || "unknown"}`}
        />
        <StatCard
          label="Session ends at the latest"
          value={time(session.absoluteExpiresAt)}
          pill={<Pill tone="info">8 h limit</Pill>}
          sub="Signed out sooner after 30 minutes of inactivity"
        />
      </div>

      <div className="mb-4">
        <RiskPanel risk={risk} posture={posture} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle title="Your account" />
          <dl className="divide-y divide-line text-sm">
            {account.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted">{label}</dt>
                <dd className="break-all text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardTitle title="How access was decided" />
          <ol className="space-y-3 text-sm">
            {[
              ["Session", "Valid, not idle, not expired, not revoked"],
              ["Device binding", "This session is used from the device it was verified on"],
              ["Device posture", `${posture.checks.filter((c) => c.passed).length} of ${posture.checks.length} checks passed`],
              ["Risk score", `${risk.score}/100 (${risk.level})`],
              ["Policy", `${decision.policyId}: ${decision.explanation}`],
            ].map(([step, detail], i) => (
              <li key={step} className="flex gap-3">
                <span className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${i === 4 ? "bg-brand text-white" : "bg-panel text-ink"}`}>
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{step}</p>
                  <p className="text-muted">{detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </AppShell>
  );
}
