import type {
  DetectedSoftware,
  DevicePostureReport,
  PostureAssessment,
  PostureCheck,
  PostureConfig,
} from "./types";

/**
 * Device posture evaluation (pure: no I/O, unit-tested in tests/device-posture.test.ts).
 */

/**
 * Baseline for October 2026. Browsers older than roughly a year, and operating
 * systems without vendor security updates, fail the checks. Review periodically.
 *
 * Windows "versions" use the Windows build family: 10 = Windows 10, 11 = Windows 11.
 * Windows 10 reached end of support on 14 October 2025, so it fails OS_SUPPORTED.
 */
export const DEFAULT_POSTURE_CONFIG: PostureConfig = {
  minBrowserVersions: { Chrome: 130, Edge: 130, Firefox: 128, Safari: 17, Opera: 115 },
  minOsVersions: { Windows: 11, macOS: 13, Android: 12, iOS: 17 },
};

const UA_BROWSERS: [name: string, pattern: RegExp][] = [
  ["Edge", /Edg(?:e|A|iOS)?\/(\d+)/],
  ["Opera", /OPR\/(\d+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/],
  ["Chrome", /(?:Chrome|CriOS)\/(\d+)/],
  ["Safari", /Version\/(\d+).*Safari/],
];

const BRAND_NAMES: Record<string, string> = {
  "Google Chrome": "Chrome",
  "Microsoft Edge": "Edge",
  Opera: "Opera",
};

export function detectBrowser(report: DevicePostureReport): DetectedSoftware | null {
  // Prefer UA Client Hints: they are not frozen like the UA string.
  for (const b of report.brands ?? []) {
    const name = BRAND_NAMES[b.brand];
    if (name) return { name, version: parseInt(b.version, 10) || null };
  }
  for (const [name, pattern] of UA_BROWSERS) {
    const m = report.userAgent.match(pattern);
    if (m) return { name, version: parseInt(m[1], 10) };
  }
  return null;
}

export function detectOs(report: DevicePostureReport): DetectedSoftware | null {
  const ua = report.userAgent;
  const platform = report.platform ?? "";
  const pv = report.platformVersion ? parseInt(report.platformVersion.split(".")[0], 10) : NaN;

  if (platform === "Windows" || /Windows NT/.test(ua)) {
    // UA-CH platformVersion: 0 = Windows 7/8/8.1, 1-12 = Windows 10, >= 13 = Windows 11.
    if (!Number.isNaN(pv)) return { name: "Windows", version: pv >= 13 ? 11 : pv >= 1 ? 10 : 8 };
    const nt = ua.match(/Windows NT (\d+)\.(\d+)/);
    if (nt && nt[1] !== "10") return { name: "Windows", version: 8 };
    // "Windows NT 10.0" is sent by both Windows 10 and 11: version unknown without UA-CH.
    return { name: "Windows", version: null };
  }
  if (/iPhone|iPad|iPod/.test(ua)) {
    const m = ua.match(/OS (\d+)_/);
    return { name: "iOS", version: m ? parseInt(m[1], 10) : null };
  }
  if (platform === "Android" || /Android/.test(ua)) {
    const m = ua.match(/Android (\d+)/);
    return { name: "Android", version: !Number.isNaN(pv) ? pv : m ? parseInt(m[1], 10) : null };
  }
  if (platform === "macOS" || /Mac OS X/.test(ua)) {
    return { name: "macOS", version: !Number.isNaN(pv) ? pv : null };
  }
  if (platform === "Linux" || /Linux/.test(ua)) return { name: "Linux", version: null };
  if (platform === "Chrome OS" || /CrOS/.test(ua)) return { name: "ChromeOS", version: null };
  return null;
}

function describe(s: DetectedSoftware | null, fallback: string) {
  return s ? `${s.name}${s.version !== null ? ` ${s.version}` : ""}` : fallback;
}

export function evaluatePosture(
  report: DevicePostureReport,
  requestUserAgent: string | null,
  config: PostureConfig = DEFAULT_POSTURE_CONFIG,
): PostureAssessment {
  const browser = detectBrowser(report);
  const os = detectOs(report);
  const checks: PostureCheck[] = [];

  checks.push({
    id: "SECURE_CONTEXT",
    passed: report.secureContext,
    detail: report.secureContext ? "Page served over a secure context" : "Page not served over HTTPS",
  });

  checks.push({
    id: "AUTOMATION",
    passed: !report.webdriver,
    detail: report.webdriver ? "Browser is controlled by automation software" : "No automation detected",
  });

  const consistent = requestUserAgent !== null && report.userAgent === requestUserAgent;
  checks.push({
    id: "UA_CONSISTENT",
    passed: consistent,
    detail: consistent
      ? "Reported browser matches the request"
      : "Reported browser does not match the request (possible tampering)",
  });

  const minBrowser = browser ? config.minBrowserVersions[browser.name] : undefined;
  checks.push({
    id: "BROWSER_SUPPORTED",
    passed: minBrowser !== undefined,
    detail: browser
      ? minBrowser !== undefined
        ? `${browser.name} is a supported browser`
        : `${browser.name} is not on the supported browser list`
      : "Browser could not be identified",
  });

  if (browser && minBrowser !== undefined) {
    const upToDate = browser.version !== null && browser.version >= minBrowser;
    checks.push({
      id: "BROWSER_UP_TO_DATE",
      passed: upToDate,
      detail: upToDate
        ? `${describe(browser, "")} meets the minimum version (${minBrowser})`
        : `${describe(browser, "")} is older than the minimum version ${minBrowser}; update the browser`,
    });
  }

  const minOs = os ? config.minOsVersions[os.name] : undefined;
  if (os && minOs !== undefined) {
    // An unknown version (e.g. "Windows NT 10.0" without client hints) cannot be judged.
    const supported = os.version === null || os.version >= minOs;
    checks.push({
      id: "OS_SUPPORTED",
      passed: supported,
      detail: supported
        ? `${describe(os, "")} receives security updates`
        : `${describe(os, "")} no longer receives security updates (minimum: ${os.name} ${minOs})`,
    });
  }

  const failedChecks = checks.filter((c) => !c.passed).map((c) => c.id);
  return {
    status: failedChecks.length === 0 ? "compliant" : "non_compliant",
    checks,
    failedChecks,
    browser,
    os,
    label: `${describe(browser, "Unknown browser")} on ${describe(os, "unknown OS")}`,
  };
}

/** Validate an untrusted JSON body into a posture report, or return null. */
export function parsePostureReport(body: unknown): DevicePostureReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max = 512) => (typeof v === "string" ? v.slice(0, max) : null);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

  const userAgent = str(b.userAgent);
  const secureContext = bool(b.secureContext);
  const cookiesEnabled = bool(b.cookiesEnabled);
  const webdriver = bool(b.webdriver);
  if (userAgent === null || secureContext === null || cookiesEnabled === null || webdriver === null) {
    return null;
  }

  const brands = Array.isArray(b.brands)
    ? b.brands
        .slice(0, 10)
        .filter((x): x is { brand: string; version: string } =>
          !!x && typeof x.brand === "string" && typeof x.version === "string",
        )
        .map((x) => ({ brand: x.brand.slice(0, 64), version: x.version.slice(0, 32) }))
    : null;
  const screen =
    b.screen && typeof b.screen === "object" &&
    typeof (b.screen as Record<string, unknown>).width === "number" &&
    typeof (b.screen as Record<string, unknown>).height === "number"
      ? {
          width: (b.screen as { width: number }).width,
          height: (b.screen as { height: number }).height,
        }
      : null;

  return {
    userAgent,
    brands,
    platform: str(b.platform, 64),
    platformVersion: str(b.platformVersion, 32),
    mobile: bool(b.mobile),
    secureContext,
    cookiesEnabled,
    webdriver,
    timezone: str(b.timezone, 64),
    language: str(b.language, 32),
    screen,
    collectedAt: new Date().toISOString(),
  };
}
