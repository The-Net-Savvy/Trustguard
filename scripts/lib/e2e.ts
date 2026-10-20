/**
 * Shared helpers for the end-to-end tests (local development only).
 *
 * A cookie-aware HTTP "browser", Keycloak login automation (incl. TOTP), device
 * posture reporting, Keycloak admin API access for temporary test users, and a
 * tiny PASS/FAIL reporter.
 */
import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";

export const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ISSUER = process.env.KEYCLOAK_ISSUER!;
export const KC = new URL(ISSUER).origin;
const REALM = ISSUER.split("/realms/")[1];

/** The simulated browser: Chrome 141 on Windows 11. */
export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Cookie-aware HTTP client (one jar per simulated browser)
// ---------------------------------------------------------------------------
type Cookie = { name: string; value: string; host: string; path: string };

export class Browser {
  cookies: Cookie[] = [];

  constructor(readonly userAgent = CHROME_UA) {}

  cookieHeader(url: URL) {
    return this.cookies
      .filter((c) => c.host === url.hostname && url.pathname.startsWith(c.path))
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
  }

  store(url: URL, res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";").map((s) => s.trim());
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      const pathAttr = attrs.find((a) => a.toLowerCase().startsWith("path="));
      const path = pathAttr ? pathAttr.slice(5) : "/";
      const expired =
        value === "" ||
        attrs.some((a) => /^max-age=(0|-)/i.test(a)) ||
        attrs.some((a) => /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now());
      this.cookies = this.cookies.filter(
        (c) => !(c.name === name && c.path === path && c.host === url.hostname),
      );
      if (!expired) this.cookies.push({ name, value, host: url.hostname, path });
    }
  }

  get(name: string) {
    return this.cookies.find((c) => c.name === name)?.value;
  }

  set(name: string, value: string) {
    this.cookies = this.cookies.filter((c) => c.name !== name);
    this.cookies.push({ name, value, host: new URL(APP).hostname, path: "/" });
  }

  async request(url: string | URL, init: RequestInit = {}) {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader(u);
    if (cookie) headers.set("cookie", cookie);
    if (!headers.has("user-agent")) headers.set("user-agent", this.userAgent);
    const res = await fetch(u, { ...init, headers, redirect: "manual" });
    this.store(u, res);
    return res;
  }

  /** Follow redirects, returning the final response and its URL. */
  async follow(url: string | URL, init: RequestInit = {}, max = 10) {
    let res = await this.request(url, init);
    let current = new URL(url);
    for (let i = 0; i < max && res.status >= 300 && res.status < 400; i++) {
      current = new URL(res.headers.get("location")!, current);
      res = await this.request(current);
    }
    return { res, url: current };
  }

  /** GET a page without following redirects. */
  async page(path: string) {
    const res = await this.request(`${APP}${path}`);
    return { status: res.status, location: res.headers.get("location"), body: await res.text() };
  }
}

// ---------------------------------------------------------------------------
// HTML and TOTP helpers
// ---------------------------------------------------------------------------
export const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x3D;/g, "=");

export function formAction(html: string, formId: string): string {
  const m =
    html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*action="([^"]+)"`)) ??
    html.match(new RegExp(`<form[^>]*action="([^"]+)"[^>]*id="${formId}"`));
  if (!m) throw new Error(`form #${formId} not found on page`);
  return decodeHtml(m[1]);
}

export function hiddenInput(html: string, name: string): string {
  const m =
    html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`)) ??
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`));
  if (!m) throw new Error(`input ${name} not found`);
  return decodeHtml(m[1]);
}

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), matching the realm OTP policy. Keycloak uses the
 * raw `totpSecret` string from the enrolment form as the HMAC key.
 */
export function totp(secret: Buffer, step = Math.floor(Date.now() / 30_000)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** Keycloak rejects re-used codes, so wait for a fresh 30-second window. */
export async function nextTotpWindow() {
  const wait = 30_000 - (Date.now() % 30_000) + 500;
  await new Promise((r) => setTimeout(r, wait));
}

// ---------------------------------------------------------------------------
// Reporter
// ---------------------------------------------------------------------------
export class Checks {
  passed = 0;
  failed = 0;

  check(name: string, ok: boolean, detail = "") {
    if (ok) this.passed++;
    else this.failed++;
    console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  }

  finish() {
    console.log(`\n${this.passed} passed, ${this.failed} failed`);
    process.exit(this.failed ? 1 : 0);
  }
}

// ---------------------------------------------------------------------------
// Keycloak admin API (test user lifecycle)
// ---------------------------------------------------------------------------
async function adminToken() {
  const res = await fetch(`${KC}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KEYCLOAK_ADMIN_USER ?? "admin",
      password: process.env.KEYCLOAK_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error(`Keycloak admin login failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function kcAdmin(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await adminToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${KC}/admin/realms/${REALM}${path}`, { ...init, headers });
}

export interface TestUser {
  username: string;
  password: string;
  keycloakId: string;
  remove(): Promise<void>;
}

/** Create a temporary Keycloak user with the given realm roles. */
export async function createTestUser(roles: string[], prefix = "e2e"): Promise<TestUser> {
  const username = `${prefix}.${randomBytes(3).toString("hex")}`;
  const password = `Tg${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}9a`;
  const created = await kcAdmin("/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      enabled: true,
      email: `${username}@trustguard.local`,
      emailVerified: true,
      firstName: "E2E",
      lastName: "Test",
      credentials: [{ type: "password", value: password, temporary: false }],
    }),
  });
  if (created.status !== 201) throw new Error(`could not create user: HTTP ${created.status}`);
  const keycloakId = created.headers.get("location")!.split("/").pop()!;
  const roleReps = await Promise.all(roles.map(async (r) => (await kcAdmin(`/roles/${r}`)).json()));
  await kcAdmin(`/users/${keycloakId}/role-mappings/realm`, { method: "POST", body: JSON.stringify(roleReps) });
  console.log(`Created temporary Keycloak user ${username} [${roles.join(", ")}]`);
  return {
    username,
    password,
    keycloakId,
    remove: async () => {
      await kcAdmin(`/users/${keycloakId}`, { method: "DELETE" });
      console.log(`Deleted temporary Keycloak user ${username}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Device posture
// ---------------------------------------------------------------------------
export interface PostureOverrides {
  userAgent?: string;
  brands?: { brand: string; version: string }[] | null;
  platform?: string | null;
  platformVersion?: string | null;
  secureContext?: boolean;
  webdriver?: boolean;
}

/** A healthy report from the simulated browser: Chrome 141 on Windows 11. */
export function posture(b: Browser, overrides: PostureOverrides = {}) {
  return {
    userAgent: b.userAgent,
    brands: [{ brand: "Google Chrome", version: "141.0.7390.55" }],
    platform: "Windows",
    platformVersion: "19.0.0",
    mobile: false,
    secureContext: true,
    cookiesEnabled: true,
    webdriver: false,
    timezone: "Africa/Lagos",
    language: "en-GB",
    screen: { width: 1920, height: 1080 },
    ...overrides,
  };
}

export async function reportPosture(b: Browser, overrides: PostureOverrides = {}) {
  const res = await b.request(`${APP}/api/device/posture`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify(posture(b, overrides)),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------
export interface LoginOptions {
  reauth?: boolean;
  returnTo?: string;
  /** Posture to report if the app asks to verify the device (default: healthy). */
  posture?: PostureOverrides;
  /** Set false to stop at /verify-device instead of reporting posture. */
  verifyDevice?: boolean;
}

/**
 * Sign in through the real Keycloak pages. If the app then asks to verify the
 * device, report posture like the browser would and continue to the destination.
 */
export async function login(
  b: Browser,
  username: string,
  password: string,
  otp: { enrol: true } | { secret: Buffer },
  { reauth = false, returnTo = "/dashboard", posture: postureOverrides, verifyDevice = true }: LoginOptions = {},
): Promise<{ finalUrl: URL; totpSecret?: Buffer; verifiedDevice: boolean }> {
  const start = await b.request(
    `${APP}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}${reauth ? "&reauth=1" : ""}`,
  );
  const loginPage = await b.follow(start.headers.get("location")!);
  const html = await loginPage.res.text();

  let afterPassword = await b.request(formAction(html, "kc-form-login"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  // Required actions (TOTP enrolment) are reached through a redirect.
  if (afterPassword.status >= 300 && afterPassword.status < 400) {
    afterPassword = (await b.follow(new URL(afterPassword.headers.get("location")!, KC))).res;
  }
  const otpHtml = await afterPassword.text();
  if (!otpHtml.includes("otp")) {
    const title = otpHtml.match(/<title>([^<]*)/)?.[1];
    const err =
      otpHtml.match(/kc-feedback-text[^>]*>([^<]*)/)?.[1] ?? otpHtml.match(/input-error[^>]*>\s*([^<]*)/)?.[1];
    throw new Error(`unexpected page after password (HTTP ${afterPassword.status}, "${title}", ${err ?? "no error text"})`);
  }

  let totpSecret: Buffer | undefined;
  let otpResponse: Response;
  if ("enrol" in otp) {
    const secretText = hiddenInput(otpHtml, "totpSecret");
    totpSecret = Buffer.from(secretText, "utf8");
    otpResponse = await b.request(formAction(otpHtml, "kc-totp-settings-form"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ totp: totp(totpSecret), totpSecret: secretText, userLabel: "e2e-test", mode: "" }),
    });
  } else {
    otpResponse = await b.request(formAction(otpHtml, "kc-otp-login-form"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ otp: totp(otp.secret) }),
    });
  }
  if (otpResponse.status !== 302) throw new Error(`OTP step did not redirect (HTTP ${otpResponse.status})`);

  let done = await b.follow(otpResponse.headers.get("location")!);
  let verifiedDevice = false;
  if (verifyDevice && done.url.pathname === "/verify-device") {
    const target = done.url.searchParams.get("returnTo") ?? "/dashboard";
    const reported = await reportPosture(b, postureOverrides);
    if (reported.status !== 200) throw new Error(`posture report failed: HTTP ${reported.status}`);
    verifiedDevice = true;
    done = await b.follow(new URL(target, APP));
  }
  return { finalUrl: done.url, totpSecret, verifiedDevice };
}

// ---------------------------------------------------------------------------
// Step-by-step login (for attack scenarios that stop part-way or tamper with a step)
// ---------------------------------------------------------------------------

/** Start an app login and return the Keycloak sign-in page HTML. */
export async function openSignIn(b: Browser, returnTo = "/dashboard", reauth = false): Promise<string> {
  const start = await b.request(
    `${APP}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}${reauth ? "&reauth=1" : ""}`,
  );
  return (await b.follow(start.headers.get("location")!)).res.text();
}

/** Submit username + password on a Keycloak sign-in page; returns the next page's HTML. */
export async function submitPassword(b: Browser, html: string, username: string, password: string): Promise<string> {
  let res = await b.request(formAction(html, "kc-form-login"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  if (res.status >= 300 && res.status < 400) res = (await b.follow(new URL(res.headers.get("location")!, KC))).res;
  return res.text();
}

/** Submit a one-time code on Keycloak's OTP page. A 302 means it was accepted. */
export async function submitOtp(b: Browser, html: string, code: string): Promise<Response> {
  return b.request(formAction(html, "kc-otp-login-form"), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ otp: code }),
  });
}

/** Keycloak's visible error text on a page, if any. */
export function keycloakError(html: string): string | null {
  const m = html.match(/kc-feedback-text[^>]*>([^<]*)/) ?? html.match(/input-error[^>]*>\s*([^<]*)/);
  return m ? m[1].trim() : null;
}
