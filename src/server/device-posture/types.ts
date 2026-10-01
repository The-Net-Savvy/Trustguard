/**
 * Device posture validation contracts.
 *
 * The browser collects a posture report (what a web page can observe about the
 * device); the BFF evaluates it against policy on every protected request.
 *
 * Scope note: a browser cannot see disk encryption, antivirus or screen-lock
 * state. Those need an installed device agent or MDM and are out of scope for
 * this prototype; the checks below are what a browser can report.
 */

/** Raw report sent by the browser (src/components/device/collect-posture.ts). */
export interface DevicePostureReport {
  userAgent: string;
  /** UA Client Hints (Chromium browsers); null where unsupported (Firefox, Safari). */
  brands: { brand: string; version: string }[] | null;
  platform: string | null;
  platformVersion: string | null;
  mobile: boolean | null;
  secureContext: boolean;
  cookiesEnabled: boolean;
  /** `navigator.webdriver`: true when the browser is driven by automation. */
  webdriver: boolean;
  timezone: string | null;
  language: string | null;
  screen: { width: number; height: number } | null;
  collectedAt: string;
}

export type PostureCheckId =
  | "SECURE_CONTEXT"
  | "AUTOMATION"
  | "UA_CONSISTENT"
  | "BROWSER_SUPPORTED"
  | "BROWSER_UP_TO_DATE"
  | "OS_SUPPORTED";

export interface PostureCheck {
  id: PostureCheckId;
  passed: boolean;
  detail: string;
}

export interface DetectedSoftware {
  name: string;
  version: number | null;
}

export interface PostureAssessment {
  status: "compliant" | "non_compliant";
  checks: PostureCheck[];
  failedChecks: PostureCheckId[];
  browser: DetectedSoftware | null;
  os: DetectedSoftware | null;
  /** Human-readable device label, e.g. "Chrome 141 on Windows 10". */
  label: string;
}

export interface PostureConfig {
  /** Minimum major version per browser; older versions fail BROWSER_UP_TO_DATE. */
  minBrowserVersions: Record<string, number>;
  /** Minimum major version per OS; older versions fail OS_SUPPORTED. */
  minOsVersions: Record<string, number>;
}
