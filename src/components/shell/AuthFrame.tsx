import Link from "next/link";
import { ShieldCheck } from "lucide-react";

/**
 * Frame for the pages outside the app shell (sign-in, device check, access denied):
 * the reference design's soft blue backdrop with one white rounded card.
 */
export function AuthFrame({ wide = false, children }: { wide?: boolean; children: React.ReactNode }) {
  return (
    <main className="backdrop-brand flex flex-1 items-center justify-center px-4 py-10">
      <div className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} rounded-[28px] bg-card p-7 shadow-[0_30px_80px_-40px_rgba(30,50,160,0.55)] sm:p-9`}>
        <Link href="/" className="mb-8 inline-flex items-center gap-2 text-sm font-bold tracking-tight text-ink">
          <ShieldCheck className="size-7 text-brand" strokeWidth={2.2} />
          Trust Guard
        </Link>
        {children}
      </div>
    </main>
  );
}

/** Primary call-to-action in the brand colour. */
export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-brand px-5 py-3.5 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(74,58,255,0.8)] transition-colors hover:bg-brand-hover";

export const SECONDARY_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-panel px-5 py-3 text-sm font-semibold text-ink hover:bg-line";

export function Notice({ tone, children }: { tone: "good" | "bad" | "warn"; children: React.ReactNode }) {
  const tones = {
    good: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    bad: "bg-rose-50 text-rose-900 ring-rose-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
  };
  return (
    <p role={tone === "bad" ? "alert" : "status"} className={`mt-6 rounded-2xl px-4 py-3 text-sm ring-1 ${tones[tone]}`}>
      {children}
    </p>
  );
}
