import { LogoutButton } from "@/components/auth/LogoutButton";
import { hasSecondFactor } from "@/server/auth/login";
import { requireSession } from "@/server/session/current";

export const metadata = { title: "Dashboard · Trust Guard" };

const ROLE_LABELS: Record<string, string> = {
  "tg-admin": "Administrator",
  "tg-employee": "Employee",
};

function formatTime(d: Date) {
  return d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export default async function DashboardPage() {
  const { user, session } = await requireSession("/dashboard");

  const facts: [string, string][] = [
    ["Username", user.username],
    ["Email", user.email ?? "—"],
    ["Roles", user.roles.map((r) => ROLE_LABELS[r] ?? r).join(", ") || "None"],
    ["Sign-in methods", session.authMethods.join(" + ") || "unknown"],
    ["Signed in", formatTime(session.createdAt)],
    ["Last verified with IdP", formatTime(session.lastVerifiedAt)],
    ["Session ends at the latest", formatTime(session.absoluteExpiresAt)],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Welcome, {user.displayName ?? user.username}
          </h1>
        </div>
        <LogoutButton />
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Your session</h2>
        <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 p-4 sm:flex-row sm:justify-between">
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="text-sm font-medium break-all sm:text-right">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-500">
          {hasSecondFactor(session.authMethods)
            ? "Multi-factor authentication verified at sign-in."
            : "No second factor recorded for this session."}
        </p>
      </section>
    </main>
  );
}
