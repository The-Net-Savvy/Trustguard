import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { evaluatePosture, parsePostureReport } from "@/server/device-posture/evaluate";
import type { DevicePostureReport } from "@/server/device-posture/types";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

function report(overrides: Partial<DevicePostureReport> = {}): DevicePostureReport {
  return {
    userAgent: CHROME_WIN,
    brands: [{ brand: "Google Chrome", version: "141" }],
    platform: "Windows",
    platformVersion: "19.0.0", // Windows 11
    mobile: false,
    secureContext: true,
    cookiesEnabled: true,
    webdriver: false,
    timezone: "Africa/Lagos",
    language: "en-GB",
    screen: { width: 1920, height: 1080 },
    collectedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("evaluatePosture", () => {
  it("accepts an up-to-date browser on a supported OS", () => {
    const a = evaluatePosture(report(), CHROME_WIN);
    assert.equal(a.status, "compliant");
    assert.deepEqual(a.failedChecks, []);
    assert.equal(a.label, "Chrome 141 on Windows 11");
  });

  it("flags Windows 10 (end of support) using UA client hints", () => {
    const a = evaluatePosture(report({ platformVersion: "10.0.0" }), CHROME_WIN);
    assert.deepEqual(a.failedChecks, ["OS_SUPPORTED"]);
    assert.equal(a.os?.version, 10);
  });

  it("does not guess the Windows version without client hints", () => {
    const a = evaluatePosture(report({ brands: null, platform: null, platformVersion: null }), CHROME_WIN);
    assert.equal(a.os?.version, null);
    assert.ok(!a.failedChecks.includes("OS_SUPPORTED"));
    assert.equal(a.browser?.name, "Chrome"); // falls back to the UA string
  });

  it("flags an outdated browser", () => {
    const old = CHROME_WIN.replace("141", "109");
    const a = evaluatePosture(report({ userAgent: old, brands: [{ brand: "Google Chrome", version: "109" }] }), old);
    assert.ok(a.failedChecks.includes("BROWSER_UP_TO_DATE"));
  });

  it("detects automation and an insecure context", () => {
    const a = evaluatePosture(report({ webdriver: true, secureContext: false }), CHROME_WIN);
    assert.ok(a.failedChecks.includes("AUTOMATION"));
    assert.ok(a.failedChecks.includes("SECURE_CONTEXT"));
  });

  it("detects a report that contradicts the request's user agent", () => {
    const a = evaluatePosture(report(), "curl/8.0");
    assert.ok(a.failedChecks.includes("UA_CONSISTENT"));
  });

  it("identifies Edge before Chrome, and Firefox without client hints", () => {
    const edge = CHROME_WIN + " Edg/140.0.0.0";
    assert.equal(evaluatePosture(report({ userAgent: edge, brands: null }), edge).browser?.name, "Edge");
    const ff = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
    const a = evaluatePosture(report({ userAgent: ff, brands: null, platform: null, platformVersion: null }), ff);
    assert.equal(a.label, "Firefox 140 on Linux");
    assert.equal(a.status, "compliant");
  });

  it("flags old Android and old iOS", () => {
    const android = "Mozilla/5.0 (Linux; Android 9; SM-A105F) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36";
    assert.ok(
      evaluatePosture(report({ userAgent: android, brands: null, platform: null, platformVersion: null }), android)
        .failedChecks.includes("OS_SUPPORTED"),
    );
    const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 Version/15.6 Mobile/15E148 Safari/604.1";
    const a = evaluatePosture(report({ userAgent: ios, brands: null, platform: null, platformVersion: null }), ios);
    assert.ok(a.failedChecks.includes("OS_SUPPORTED"));
    assert.ok(a.failedChecks.includes("BROWSER_UP_TO_DATE"));
  });
});

describe("parsePostureReport", () => {
  it("rejects malformed bodies", () => {
    assert.equal(parsePostureReport(null), null);
    assert.equal(parsePostureReport({ userAgent: "x" }), null);
    assert.equal(parsePostureReport({ userAgent: 1, secureContext: true, cookiesEnabled: true, webdriver: false }), null);
  });

  it("normalises a valid body and ignores the client's timestamp", () => {
    const r = parsePostureReport({
      userAgent: "ua",
      secureContext: true,
      cookiesEnabled: true,
      webdriver: false,
      brands: [{ brand: "Google Chrome", version: "141" }, { bad: true }],
      collectedAt: "1999-01-01T00:00:00Z",
    });
    assert.ok(r);
    assert.equal(r.brands?.length, 1);
    assert.notEqual(r.collectedAt, "1999-01-01T00:00:00Z");
  });
});
