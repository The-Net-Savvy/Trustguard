import Link from "next/link";
import { StatusBadge } from "@/components/status/StatusBadge";
import { getSystemHealth } from "@/server/health/checks";

export const dynamic = "force-dynamic";

const PILLARS: [string, "Implemented" | "Planned"][] = [
  ["Identity-centric access control", "Implemented"],
  ["Multi-factor authentication", "Implemented"],
  ["Device posture validation", "Implemented"],
  ["Continuous verification", "Implemented"],
  ["Least privilege", "Implemented"],
  ["Risk-aware access decisions", "Implemented"],
  ["Session management", "Implemented"],
  ["Administrative controls", "Implemented"],
  ["Audit logging", "Implemented"],
];

export default async function Home() {
  const health = await getSystemHealth();
  const components = [
    { name: "Application (Next.js BFF)", ...health.components.app },
    { name: "Database (Supabase PostgreSQL)", ...health.components.database },
    { name: "Identity Provider (Keycloak)", ...health.components.identityProvider },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6">
      <header className="mb-10">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Zero-Trust-Inspired Authentication for SMEs
        </p>
        <h1 className="mt-1 text-4xl font-bold tracking-tight">Trust Guard</h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          A research prototype for securing remote access in Nigerian small and medium
          enterprises. Never trust, always verify.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          Sign in
        </Link>
      </header>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">System status</h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {components.map((c) => (
            <li key={c.name} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-sm text-slate-500">
                  {c.detail}
                  {c.latencyMs !== undefined && ` · ${c.latencyMs} ms`}
                </p>
              </div>
              <StatusBadge status={c.status} />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Checked {new Date(health.checkedAt).toLocaleString()} · JSON at{" "}
          <code>/api/health</code>
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Framework capabilities</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {PILLARS.map(([p, state]) => (
            <li
              key={p}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
            >
              {p}
              <span
                className={`text-xs ${state === "Implemented" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400"}`}
              >
                {state}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
