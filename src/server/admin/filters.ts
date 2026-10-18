/** Audit log filters (pure, unit-tested in tests/admin.test.ts). */

export interface AuditFilters {
  type?: string;
  outcome?: string;
  user?: string;
  from?: string;
  to?: string;
}

const OUTCOMES = new Set(["success", "failure", "allow", "step_up", "deny"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate untrusted filter input (from the query string). Invalid values are dropped. */
export function cleanAuditFilters(raw: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  const type = one(raw.type);
  const outcome = one(raw.outcome);
  const user = one(raw.user);
  const from = one(raw.from);
  const to = one(raw.to);
  return {
    type: type && /^[a-z._]{1,64}$/.test(type) ? type : undefined,
    outcome: outcome && OUTCOMES.has(outcome) ? outcome : undefined,
    user: user && user.length <= 128 ? user : undefined,
    from: from && ISO_DATE.test(from) ? from : undefined,
    to: to && ISO_DATE.test(to) ? to : undefined,
  };
}
