import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { csvCell, toCsv } from "@/server/admin/csv";
import { cleanAuditFilters } from "@/server/admin/filters";
import { parseAdminAction } from "@/server/admin/types";
import { decide } from "@/server/policy-engine/decide";
import type { RiskAssessment, RiskSignalCode } from "@/server/risk-engine/types";

const UUID = "0b9f5a52-2f0e-4f6b-9f39-6c1d1a4c8e21";

describe("parseAdminAction", () => {
  it("accepts known actions with a UUID target", () => {
    assert.deepEqual(parseAdminAction("revoke_session", UUID), { kind: "revoke_session", sessionId: UUID });
    assert.deepEqual(parseAdminAction("suspend_user", UUID), { kind: "suspend_user", userId: UUID });
    assert.deepEqual(parseAdminAction("block_device", UUID), { kind: "block_device", deviceId: UUID });
  });

  it("rejects unknown actions and non-UUID targets", () => {
    assert.equal(parseAdminAction("delete_everything", UUID), null);
    assert.equal(parseAdminAction("revoke_session", "1 or 1=1"), null);
    assert.equal(parseAdminAction("revoke_session", null), null);
    assert.equal(parseAdminAction(undefined, UUID), null);
  });
});

describe("CSV export", () => {
  it("quotes cells and doubles embedded quotes", () => {
    assert.equal(csvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(csvCell(null), '""');
    assert.equal(csvCell({ a: 1 }), '"{""a"":1}"');
  });

  it("neutralises spreadsheet formulas (CSV injection)", () => {
    for (const evil of ["=HYPERLINK(\"http://x\")", "+1+1", "-2+3", "@SUM(A1)", "\t=1"]) {
      assert.ok(csvCell(evil).startsWith(`"'`), evil);
    }
    assert.equal(csvCell("ordinary"), '"ordinary"');
  });

  it("builds rows with CRLF line endings", () => {
    assert.equal(toCsv(["a", "b"], [[1, "x"]]), '"a","b"\r\n"1","x"\r\n');
  });
});

describe("cleanAuditFilters", () => {
  it("keeps valid filters", () => {
    assert.deepEqual(
      cleanAuditFilters({ type: "admin.action", outcome: "deny", user: "tg.admin", from: "2026-10-01", to: "2026-10-15" }),
      { type: "admin.action", outcome: "deny", user: "tg.admin", from: "2026-10-01", to: "2026-10-15" },
    );
  });

  it("drops invalid values", () => {
    assert.deepEqual(
      cleanAuditFilters({ type: "x'; drop table", outcome: "maybe", from: "yesterday", to: ["2026-13-99x"] }),
      { type: undefined, outcome: undefined, user: undefined, from: undefined, to: undefined },
    );
  });
});

describe("admin.manage policy", () => {
  const risk = (score: number, codes: RiskSignalCode[] = []): RiskAssessment => ({
    score,
    level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
    signals: codes.map((code) => ({ code, weight: 0, description: code })),
  });
  const req = (score: number, authAgeMinutes: number, roles = ["tg-admin", "tg-employee"], codes: RiskSignalCode[] = []) =>
    decide({ resource: "admin.manage", roles, risk: risk(score, codes), authAgeMinutes, device: { trusted: false, blocked: false } });

  it("is stricter than viewing the console: sign-in must be under 30 minutes old", () => {
    assert.equal(req(10, 29).decision, "allow");
    assert.equal(req(10, 31).reason, "REAUTH_REQUIRED");
    const view = decide({ resource: "admin.console", roles: ["tg-admin"], risk: risk(10), authAgeMinutes: 31, device: { trusted: false, blocked: false } });
    assert.equal(view.decision, "allow");
  });

  it("allows medium risk only within 10 minutes of signing in", () => {
    assert.equal(req(45, 5).decision, "allow");
    assert.equal(req(45, 15).decision, "step_up");
  });

  it("denies employees and recent failed sign-ins", () => {
    assert.equal(req(0, 1, ["tg-employee"]).reason, "ROLE_REQUIRED");
    assert.equal(req(20, 1, undefined, ["RECENT_FAILED_LOGINS"]).reason, "DENY_SIGNAL");
  });
});
