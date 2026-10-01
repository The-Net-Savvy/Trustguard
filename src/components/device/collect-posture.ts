/**
 * Browser-side posture collection. Only reads what any web page can observe;
 * nothing is stored in the browser.
 */

interface UADataBrand {
  brand: string;
  version: string;
}

interface UAData {
  brands: UADataBrand[];
  mobile: boolean;
  platform: string;
  getHighEntropyValues(hints: string[]): Promise<{ platformVersion?: string; fullVersionList?: UADataBrand[] }>;
}

export async function collectPosture() {
  const uaData = (navigator as Navigator & { userAgentData?: UAData }).userAgentData;
  let brands: UADataBrand[] | null = null;
  let platform: string | null = null;
  let platformVersion: string | null = null;
  let mobile: boolean | null = null;

  if (uaData) {
    const high = await uaData.getHighEntropyValues(["platformVersion", "fullVersionList"]).catch(() => null);
    brands = (high?.fullVersionList ?? uaData.brands).map(({ brand, version }) => ({ brand, version }));
    platform = uaData.platform || null;
    platformVersion = high?.platformVersion ?? null;
    mobile = uaData.mobile;
  }

  return {
    userAgent: navigator.userAgent,
    brands,
    platform,
    platformVersion,
    mobile,
    secureContext: window.isSecureContext,
    cookiesEnabled: navigator.cookieEnabled,
    webdriver: navigator.webdriver === true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    language: navigator.language ?? null,
    screen: { width: window.screen.width, height: window.screen.height },
  };
}

export type PostureResult =
  | { ok: true; status: "compliant" | "non_compliant"; failedChecks: string[]; device: string }
  | { ok: false; error: string; httpStatus: number };

let inFlight: Promise<PostureResult> | null = null;

/** Report posture to the server. Concurrent calls share one request. */
export function sendPosture(): Promise<PostureResult> {
  inFlight ??= postPosture().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function postPosture(): Promise<PostureResult> {
  try {
    const res = await fetch("/api/device/posture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(await collectPosture()),
      credentials: "same-origin",
    });
    const body = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...body } : { ok: false, error: body.error ?? "error", httpStatus: res.status };
  } catch {
    return { ok: false, error: "network_error", httpStatus: 0 };
  }
}
