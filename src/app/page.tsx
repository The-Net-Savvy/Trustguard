import Link from "next/link";
import { ArrowRight, CircleCheck, ShieldCheck } from "lucide-react";
import { PRIMARY_BUTTON } from "@/components/shell/AuthFrame";
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
    <main className="backdrop-brand flex flex-1 justify-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-5xl">
        <header className="mb-10 flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-2 text-sm font-bold tracking-tight">
              <ShieldCheck className="size-7 text-brand" strokeWidth={2.2} /> Trust Guard
            </span>
            <h1 className="mt-5 max-w-2xl text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              Never trust, always verify.
            </h1>
            <p className="mt-4 max-w-xl text-ink/70">
              A Zero-Trust-inspired authentication framework for securing remote access in Nigerian small and
              medium enterprises.
            </p>
          </div>
          <Link href="/dashboard" className={`${PRIMARY_BUTTON} shrink-0 px-7`}>
            Sign in <ArrowRight className="size-4" />
          </Link>
        </header>

        <section className="mb-4 rounded-[28px] bg-card p-6 sm:p-7">
          <h2 className="mb-1 text-lg font-bold tracking-tight">System status</h2>
          <p className="mb-5 text-xs text-muted">
            Checked {new Date(health.checkedAt).toLocaleString("en-GB")} · JSON at <code>/api/health</code>
          </p>
          <ul className="grid gap-3 md:grid-cols-3">
            {components.map((c) => (
              <li key={c.name} className="rounded-2xl bg-panel p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted">
                  {c.detail}
                  {c.latencyMs !== undefined && ` · ${c.latencyMs} ms`}
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-[28px] bg-card p-6 sm:p-7">
          <h2 className="mb-5 text-lg font-bold tracking-tight">Framework capabilities</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map(([p, state]) => (
              <li key={p} className="flex items-center justify-between gap-3 rounded-2xl bg-panel px-4 py-3 text-sm font-medium">
                {p}
                <span className={state === "Implemented" ? "text-emerald-600" : "text-muted"}>
                  <CircleCheck className="size-[18px]" aria-label={state} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
