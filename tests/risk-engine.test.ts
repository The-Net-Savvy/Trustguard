import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { assessRisk, riskLevel } from "@/server/risk-engine/assess";
import { inTrustedNetworks, isOffHours, parseDays } from "@/server/risk-engine/context";
import type { PostureAssessment, PostureCheckId } from "@/server/device-posture/types";
import type { RiskInput } from "@/server/risk-engine/types";

function posture(failed: PostureCheckId[] = []): PostureAssessment {
  const ids: PostureCheckId[] = ["SECURE_CONTEXT", "AUTOMATION", "UA_CONSISTENT", "BROWSER_SUPPORTED", "BROWSER_UP_TO_DATE", "OS_SUPPORTED"];
  return {
    status: failed.length ? "non_compliant" : "compliant",
    checks: ids.map((id) => ({ id, passed: !failed.includes(id), detail: id })),
    failedChecks: failed,
    browser: { name: "Chrome", version: 141 },
    os: { name: "Windows", version: 11 },
    label: "Chrome 141 on Windows 11",
  };
}

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    posture: posture(),
    device: { isNew: false, trusted: false },
    network: { ipChanged: false, onTrustedNetwork: null },
    time: { offHours: false },
    recentFailedLogins: 0,
    ...overrides,
  };
}

describe("assessRisk", () => {
  it("scores a clean context as low risk with no signals", () => {
    const r = assessRisk(input());
    assert.equal(r.score, 0);
    assert.equal(r.level, "low");
    assert.deepEqual(r.signals, []);
  });

  it("adds weights for each signal", () => {
    // new device (20) + unsupported OS (15) + off hours (10) = 45 -> medium
    const r = assessRisk(input({ posture: posture(["OS_SUPPORTED"]), device: { isNew: true, trusted: false }, time: { offHours: true } }));
    assert.equal(r.score, 45);
    assert.equal(r.level, "medium");
    assert.deepEqual(r.signals.map((s) => s.code).sort(), ["NEW_DEVICE", "OFF_HOURS", "OS_UNSUPPORTED"]);
  });

  it("treats automation as high risk on its own", () => {
    const r = assessRisk(input({ posture: posture(["AUTOMATION"]) }));
    assert.equal(r.level, "high");
  });

  it("does not count a trusted device as new", () => {
    const r = assessRisk(input({ device: { isNew: true, trusted: true } }));
    assert.equal(r.score, 0);
  });

  it("only fires failed-login risk at the threshold", () => {
    assert.equal(assessRisk(input({ recentFailedLogins: 2 })).score, 0);
    assert.equal(assessRisk(input({ recentFailedLogins: 3 })).score, 20);
  });

  it("caps the score at 100", () => {
    const r = assessRisk(input({ posture: posture(["AUTOMATION", "UA_CONSISTENT", "SECURE_CONTEXT"]) }));
    assert.equal(r.score, 100);
  });

  it("maps thresholds to levels", () => {
    assert.equal(riskLevel(29), "low");
    assert.equal(riskLevel(30), "medium");
    assert.equal(riskLevel(59), "medium");
    assert.equal(riskLevel(60), "high");
  });
});

describe("context helpers", () => {
  const lagos = { timeZone: "Africa/Lagos", hours: "07:00-19:00", days: [1, 2, 3, 4, 5] };

  it("evaluates business hours in the configured time zone", () => {
    // Thursday 1 Oct 2026, 05:40 UTC = 06:40 in Lagos (UTC+1): before opening.
    assert.equal(isOffHours(new Date("2026-10-01T05:40:00Z"), lagos), true);
    assert.equal(isOffHours(new Date("2026-10-01T06:00:00Z"), lagos), false); // 07:00 Lagos
    assert.equal(isOffHours(new Date("2026-10-01T18:00:00Z"), lagos), true); // 19:00 Lagos
    assert.equal(isOffHours(new Date("2026-10-03T10:00:00Z"), lagos), true); // Saturday
  });

  it("parses weekday specs", () => {
    assert.deepEqual(parseDays("1-5"), [1, 2, 3, 4, 5]);
    assert.deepEqual(parseDays("1,3,6-7"), [1, 3, 6, 7]);
  });

  it("matches IPv4 CIDR ranges", () => {
    assert.equal(inTrustedNetworks("10.1.2.3", []), null);
    assert.equal(inTrustedNetworks("10.1.2.3", ["10.0.0.0/8"]), true);
    assert.equal(inTrustedNetworks("192.168.1.20", ["192.168.1.0/24"]), true);
    assert.equal(inTrustedNetworks("192.168.2.20", ["192.168.1.0/24"]), false);
    assert.equal(inTrustedNetworks("::1", ["::1"]), true);
    assert.equal(inTrustedNetworks(null, ["10.0.0.0/8"]), false);
  });
});
