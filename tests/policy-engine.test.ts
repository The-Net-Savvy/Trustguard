import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { decide } from "@/server/policy-engine/decide";
import type { AccessRequest } from "@/server/policy-engine/types";
import type { RiskAssessment, RiskSignalCode } from "@/server/risk-engine/types";

function risk(score: number, codes: RiskSignalCode[] = []): RiskAssessment {
  return {
    score,
    level: score >= 60 ? "high" : score >= 30 ? "medium" : "low",
    signals: codes.map((code) => ({ code, weight: 0, description: code })),
  };
}

function req(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    resource: "dashboard",
    roles: ["tg-employee"],
    risk: risk(0),
    authAgeMinutes: 1,
    device: { trusted: false, blocked: false },
    ...overrides,
  };
}

describe("decide: default deny and least privilege", () => {
  it("denies resources without a policy", () => {
    const d = decide(req({ resource: "payroll" }));
    assert.equal(d.decision, "deny");
    assert.equal(d.reason, "NO_POLICY");
  });

  it("denies an employee access to the admin console", () => {
    const d = decide(req({ resource: "admin.console" }));
    assert.equal(d.decision, "deny");
    assert.equal(d.reason, "ROLE_REQUIRED");
  });

  it("denies blocked devices even for admins", () => {
    const d = decide(req({ roles: ["tg-admin", "tg-employee"], device: { trusted: true, blocked: true } }));
    assert.equal(d.reason, "DEVICE_BLOCKED");
  });

  it("denies on hard-deny signals regardless of score", () => {
    const d = decide(req({ risk: risk(10, ["UA_MISMATCH"]) }));
    assert.equal(d.decision, "deny");
    assert.equal(d.reason, "DENY_SIGNAL");
  });
});

describe("decide: dashboard (allow up to medium)", () => {
  it("allows low and medium risk", () => {
    assert.equal(decide(req({ risk: risk(10) })).decision, "allow");
    assert.equal(decide(req({ risk: risk(45) })).decision, "allow");
  });

  it("denies high risk (no step-up band)", () => {
    const d = decide(req({ risk: risk(65) }));
    assert.equal(d.decision, "deny");
    assert.equal(d.reason, "RISK_TOO_HIGH");
  });
});

describe("decide: admin console (low allowed, medium needs a fresh sign-in)", () => {
  const admin = { resource: "admin.console", roles: ["tg-admin", "tg-employee"] };

  it("allows low risk with a recent sign-in", () => {
    assert.equal(decide(req({ ...admin, risk: risk(10), authAgeMinutes: 30 })).decision, "allow");
  });

  it("requires re-authentication after maxAuthAge even at low risk", () => {
    const d = decide(req({ ...admin, risk: risk(10), authAgeMinutes: 61 }));
    assert.equal(d.decision, "step_up");
    assert.equal(d.reason, "REAUTH_REQUIRED");
  });

  it("steps up medium risk when the sign-in is older than 10 minutes", () => {
    const d = decide(req({ ...admin, risk: risk(45), authAgeMinutes: 11 }));
    assert.equal(d.decision, "step_up");
    assert.equal(d.reason, "RISK_STEP_UP");
  });

  it("allows medium risk right after a step-up", () => {
    const d = decide(req({ ...admin, risk: risk(45), authAgeMinutes: 2 }));
    assert.equal(d.decision, "allow");
    assert.equal(d.reason, "STEP_UP_SATISFIED");
  });

  it("denies high risk outright", () => {
    assert.equal(decide(req({ ...admin, risk: risk(70), authAgeMinutes: 0 })).decision, "deny");
  });
});
