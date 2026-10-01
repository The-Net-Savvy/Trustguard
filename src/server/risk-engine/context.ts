/**
 * Helpers that turn raw request context into risk inputs (pure, unit-tested).
 */

export interface BusinessHours {
  timeZone: string;
  /** "HH:MM-HH:MM", e.g. "07:00-19:00". */
  hours: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  days: number[];
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function isOffHours(at: Date, cfg: BusinessHours): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = WEEKDAYS[get("weekday")];
  const minutes = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);

  const [start, end] = cfg.hours.split("-").map((hm) => {
    const [h, m] = hm.split(":").map((n) => parseInt(n, 10));
    return h * 60 + (m || 0);
  });
  if (!cfg.days.includes(weekday)) return true;
  return minutes < start || minutes >= end;
}

/** Parse "1-5" or "1,2,3,4,5" into ISO weekday numbers. */
export function parseDays(spec: string): number[] {
  const days = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((n) => parseInt(n.trim(), 10));
    for (let d = a; d <= (b ?? a); d++) if (d >= 1 && d <= 7) days.add(d);
  }
  return [...days];
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

/**
 * Whether `ip` falls in any of the CIDR ranges (IPv4, plus exact-match IPv6).
 * Returns null when no trusted networks are configured.
 */
export function inTrustedNetworks(ip: string | null, cidrs: string[]): boolean | null {
  if (cidrs.length === 0) return null;
  if (!ip) return false;
  const addr = ipv4ToInt(ip);
  return cidrs.some((cidr) => {
    const [base, bitsStr] = cidr.split("/");
    if (addr === null || base.includes(":")) return base === ip;
    const baseInt = ipv4ToInt(base);
    const bits = bitsStr === undefined ? 32 : parseInt(bitsStr, 10);
    if (baseInt === null || Number.isNaN(bits)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((addr & mask) >>> 0) === ((baseInt & mask) >>> 0);
  });
}
