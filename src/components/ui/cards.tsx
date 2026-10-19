import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

/** Building blocks of the reference design: rounded white cards, stat cards and pills. */

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <section className={`rounded-3xl bg-card p-5 sm:p-6 ${className}`}>{children}</section>;
}

export function CardTitle({
  title,
  hint,
  href,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </div>
      {href && <ArrowLink href={href} dark />}
    </div>
  );
}

export function ArrowLink({ href, dark = false, light = false }: { href: string; dark?: boolean; light?: boolean }) {
  return (
    <Link
      href={href}
      aria-label="Open"
      className={`grid size-10 shrink-0 place-items-center rounded-full transition-transform hover:scale-105 ${
        dark ? "bg-ink text-white" : light ? "bg-white text-ink" : "bg-panel text-ink"
      }`}
    >
      <ArrowUpRight className="size-4" strokeWidth={2} />
    </Link>
  );
}

export type Tone = "good" | "bad" | "warn" | "info" | "neutral";

const PILL: Record<Tone, string> = {
  good: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  bad: "bg-rose-50 text-rose-600 ring-rose-200",
  warn: "bg-amber-50 text-amber-700 ring-amber-200",
  info: "bg-brand-soft text-brand ring-brand/20",
  neutral: "bg-slate-50 text-slate-600 ring-slate-200",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${PILL[tone]}`}>
      {children}
    </span>
  );
}

/**
 * A stat card. `highlight` = the brand-coloured card (one per row, on what the page is
 * about); `band` = the coloured header strip of the reference's status cards.
 */
export function StatCard({
  label,
  value,
  pill,
  sub,
  href,
  highlight = false,
  band,
}: {
  label: string;
  value: React.ReactNode;
  pill?: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  highlight?: boolean;
  band?: "blue" | "orange" | "yellow" | "green";
}) {
  const bands = {
    blue: "bg-[#8fa6f5] text-[#1f2a6b]",
    orange: "bg-[#f3a26b] text-[#5b2a0b]",
    yellow: "bg-[#f7dd7a] text-[#5a4708]",
    green: "bg-[#8ee6a6] text-[#0f4a23]",
  };
  if (band) {
    return (
      <div className="overflow-hidden rounded-3xl bg-card">
        <div className={`px-5 py-2.5 text-sm font-semibold ${bands[band]}`}>{label}</div>
        <div className="flex items-end gap-3 px-5 py-4">
          <span className="text-3xl font-bold tracking-tight">{value}</span>
          <div className="flex flex-col gap-1 pb-1">
            {pill}
            {sub && <span className="text-xs text-muted">{sub}</span>}
          </div>
          {href && (
            <span className="ml-auto self-start">
              <ArrowLink href={href} />
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className={`flex min-h-[150px] flex-col rounded-3xl p-5 ${highlight ? "bg-brand text-white" : "bg-card"}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`text-sm font-medium ${highlight ? "text-white/85" : "text-ink/80"}`}>{label}</span>
        {href && <ArrowLink href={href} light={highlight} />}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-3 pt-4">
        <span className="text-[28px] font-bold leading-none tracking-tight">{value}</span>
        {pill}
      </div>
      {sub && <p className={`mt-2 text-xs ${highlight ? "text-white/70" : "text-muted"}`}>{sub}</p>}
    </div>
  );
}
