/**
 * End-to-end authentication test against the running stack (local development only).
 *
 * Creates a temporary Keycloak user, then drives the real login pages over HTTP:
 * first login with TOTP enrolment, MFA-verified sessions, logout, re-login with a
 * one-time code, back-channel logout triggered from Keycloak, and several negative
 * cases. The temporary Keycloak user is deleted at the end; its audit trail in the
 * app database is kept (the audit log is append-only).
 *
 * Usage (app on :3000, Keycloak on :8080):  npm run test:e2e:auth
 */
import "dotenv/config";
import { createHmac, randomBytes } from "node:crypto";
import { Client } from "pg";

const APP = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ISSUER = process.env.KEYCLOAK_ISSUER!;
const KC = new URL(ISSUER).origin;
const REALM = ISSUER.split("/realms/")[1];

// ---------------------------------------------------------------------------
// Tiny cookie-aware HTTP client (one jar per simulated browser)
// ---------------------------------------------------------------------------
type Cookie = { name: string; value: string; host: string; path: string };

class Browser {
  cookies: Cookie[] = [];

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

  async request(url: string | URL, init: RequestInit = {}) {
    const u = new URL(url);
    const headers = new Headers(init.headers);
    const cookie = this.cookieHeader(u);
    if (cookie) headers.set("cookie", cookie);
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&#x3D;/g, "=");

function formAction(html: string, formId: string): string {
  const m = html.match(new RegExp(`<form[^>]*id="${formId}"[^>]*action="([^"]+)"`)) ??
    html.match(new RegExp(`<form[^>]*action="([^"]+)"[^>]*id="${formId}"`));
  if (!m) throw new Error(`form #${formId} not found on page`);
  return decodeHtml(m[1]);
}

function hiddenInput(html: string, name: string): string {
  const m = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`)) ??
    html.match(new RegExp(`value="([^"]*)"[^>]*name="${name}"`));
  if (!m) throw new Error(`input ${name} not found`);
  return decodeHtml(m[1]);
}

/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s), matching the realm OTP policy. Keycloak uses the
 * raw `totpSecret` string from the enrolment form as the HMAC key.
 */
function totp(secret: Buffer, step = Math.floor(Date.now() / 30_000)): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

/** Keycloak rejects re-used codes, so wait for a fresh 30-second window. */
async function nextTotpWindow() {
  const wait = 30_000 - (Date.now() % 30_000) + 500;
  await new Promise((r) => setTimeout(r, wait));
}

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
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

async function admin(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await adminToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${KC}/admin/realms/${REALM}${path}`, { ...init, headers });
}

// ---------------------------------------------------------------------------
// Login flow
// ---------------------------------------------------------------------------
async function login(
  b: Browser,
  username: string,
  password: string,
  otp: { enrol: true } | { secret: Buffer },
  { reauth = false, returnTo = "/dashboard" }: { reauth?: boolean; returnTo?: string } = {},
): Promise<{ finalUrl: URL; totpSecret?: Buffer }> {
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
    const err = otpHtml.match(/kc-feedback-text[^>]*>([^<]*)/)?.[1] ?? otpHtml.match(/input-error[^>]*>\s*([^<]*)/)?.[1];
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
      body: new URLSearchParams({
        totp: totp(totpSecret),
        totpSecret: secretText,
        userLabel: "e2e-test",
        mode: "",
      }),
    });
  } else {
    otpResponse = await b.request(formAction(otpHtml, "kc-otp-login-form"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ otp: totp(otp.secret) }),
    });
  }
  if (otpResponse.status !== 302) {
    throw new Error(`OTP step did not redirect (HTTP ${otpResponse.status})`);
  }
  const done = await b.follow(otpResponse.headers.get("location")!);
  return { finalUrl: done.url, totpSecret };
}

async function dashboardStatus(b: Browser) {
  const res = await b.request(`${APP}/dashboard`);
  return { status: res.status, location: res.headers.get("location"), body: await res.text() };
}

// ---------------------------------------------------------------------------
// Test run
// ---------------------------------------------------------------------------
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const username = `e2e.${randomBytes(3).toString("hex")}`;
  const password = `Tg${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}9a`;
  console.log(`Creating temporary Keycloak user ${username}`);

  const created = await admin("/users", {
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
  const userId = created.headers.get("location")!.split("/").pop()!;
  const role = await (await admin("/roles/tg-employee")).json();
  await admin(`/users/${userId}/role-mappings/realm`, { method: "POST", body: JSON.stringify([role]) });

  try {
    console.log("\n1. Route protection");
    const anon = new Browser();
    const r1 = await dashboardStatus(anon);
    check("unauthenticated /dashboard redirects to /login", r1.status === 307 && !!r1.location?.includes("/login"));
    const forged = new Browser();
    forged.cookies.push({ name: "tg_session", value: "forged", host: "localhost", path: "/" });
    const r2 = await dashboardStatus(forged);
    check("forged session cookie is rejected", r2.status === 307 && !!r2.location?.includes("/login"));

    console.log("\n2. First login: mandatory TOTP enrolment, then re-authentication with a code");
    const browser = new Browser();
    const destination = "/dashboard?from=e2e";
    const enrol = await login(browser, username, password, { enrol: true }, { returnTo: destination });
    check(
      "enrolment-only login is not trusted (amr lacks otp)",
      enrol.finalUrl.pathname === "/login" && enrol.finalUrl.searchParams.get("error") === "mfa_required",
      enrol.finalUrl.href,
    );
    check(
      "failed login keeps the destination",
      enrol.finalUrl.searchParams.get("returnTo") === destination,
      enrol.finalUrl.searchParams.get("returnTo") ?? "missing",
    );
    check("no session after enrolment-only login", !browser.get("tg_session"));
    await nextTotpWindow();
    const first = await login(
      browser,
      username,
      password,
      { secret: enrol.totpSecret! },
      { reauth: true, returnTo: enrol.finalUrl.searchParams.get("returnTo")! },
    );
    check(
      "re-authentication returns to the original destination",
      first.finalUrl.origin === APP && first.finalUrl.pathname + first.finalUrl.search === destination,
      first.finalUrl.href,
    );
    const cookie = browser.get("tg_session");
    check("session cookie issued", !!cookie);
    check("login-transaction cookie cleared", !browser.get("tg_login_tx"));
    const d1 = await dashboardStatus(browser);
    check("dashboard renders for the session", d1.status === 200 && d1.body.includes(username));
    check("no Keycloak tokens in the page", !/eyJ[A-Za-z0-9_-]{10,}\./.test(d1.body));

    const s1 = await db.query(
      `select s.id, s.auth_methods, s.status, u.roles from trustguard.sessions s
         join trustguard.users u on u.id = s.user_id
        where u.username = $1 order by s.created_at desc limit 1`,
      [username],
    );
    check("session stored with amr incl. otp", s1.rows[0]?.auth_methods.includes("otp"), s1.rows[0]?.auth_methods.join(","));
    check("roles projected from Keycloak", s1.rows[0]?.roles.includes("tg-employee"), s1.rows[0]?.roles.join(","));

    console.log("\n3. Logout");
    const evil = await browser.request(`${APP}/api/auth/logout`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    check("cross-origin logout rejected (403)", evil.status === 403);
    const out = await browser.request(`${APP}/api/auth/logout`, {
      method: "POST",
      headers: { origin: APP },
    });
    const kcLogout = new URL(out.headers.get("location")!);
    check("logout redirects to Keycloak end-session", kcLogout.pathname.endsWith("/protocol/openid-connect/logout"));
    const afterLogout = await browser.follow(kcLogout);
    check("Keycloak returns to /login?signed_out=1", afterLogout.url.pathname === "/login" && afterLogout.url.searchParams.get("signed_out") === "1", afterLogout.url.href);
    const replay = new Browser();
    replay.cookies.push({ name: "tg_session", value: cookie!, host: "localhost", path: "/" });
    const r3 = await dashboardStatus(replay);
    check("old session cookie no longer works", r3.status === 307);

    console.log("\n4. Second login with one-time code");
    await nextTotpWindow();
    // Full login with a hostile destination: must still end on the app's own dashboard.
    const second = await login(
      browser,
      username,
      password,
      { secret: enrol.totpSecret! },
      { returnTo: "/\t/evil.example/phish" },
    );
    check(
      "second login succeeds and ignores hostile returnTo",
      second.finalUrl.origin === APP && second.finalUrl.pathname === "/dashboard",
      second.finalUrl.href,
    );

    console.log("\n   Continuous verification: expired access token is refreshed with Keycloak");
    const latest = `(select s.id from trustguard.sessions s join trustguard.users u on u.id = s.user_id
                      where u.username = $1 order by s.created_at desc limit 1)`;
    const before = await db.query(
      `update trustguard.sessions set access_expires_at = now() - interval '1 minute',
              last_verified_at = now() - interval '5 minutes'
        where id = ${latest} returning last_verified_at`,
      [username],
    );
    const d2 = await dashboardStatus(browser);
    const after = await db.query(
      `select last_verified_at, access_expires_at > now() as fresh from trustguard.sessions where id = ${latest}`,
      [username],
    );
    check("dashboard still served after refresh", d2.status === 200, `HTTP ${d2.status}`);
    check(
      "session re-verified with Keycloak",
      after.rows[0].fresh && after.rows[0].last_verified_at > before.rows[0].last_verified_at,
    );

    console.log("\n5. Back-channel logout (administrator ends the Keycloak session)");
    await admin(`/users/${userId}/logout`, { method: "POST" });
    await new Promise((r) => setTimeout(r, 1500));
    const r4 = await dashboardStatus(browser);
    check("app session revoked immediately", r4.status === 307, `HTTP ${r4.status}`);
    const s2 = await db.query(
      `select s.status, s.revoked_reason from trustguard.sessions s
         join trustguard.users u on u.id = s.user_id
        where u.username = $1 order by s.created_at desc limit 1`,
      [username],
    );
    check("revocation reason recorded", s2.rows[0]?.revoked_reason === "idp_backchannel_logout", s2.rows[0]?.revoked_reason);

    console.log("\n6. Idle timeout");
    await nextTotpWindow();
    await login(browser, username, password, { secret: enrol.totpSecret! });
    await db.query(
      `update trustguard.sessions set last_seen_at = now() - interval '2 hours'
        where id = (select s.id from trustguard.sessions s join trustguard.users u on u.id = s.user_id
                     where u.username = $1 order by s.created_at desc limit 1)`,
      [username],
    );
    const r5 = await dashboardStatus(browser);
    const s3 = await db.query(
      `select s.status, s.revoked_reason from trustguard.sessions s
         join trustguard.users u on u.id = s.user_id
        where u.username = $1 order by s.created_at desc limit 1`,
      [username],
    );
    check("idle session rejected", r5.status === 307, `HTTP ${r5.status}`);
    check("session marked expired (idle_timeout)", s3.rows[0]?.status === "expired" && s3.rows[0]?.revoked_reason === "idle_timeout");

    console.log("\n7. Negative cases");
    const tamper = new Browser();
    const t1 = await tamper.request(`${APP}/api/auth/callback?code=abc&state=xyz`);
    check("callback without login transaction rejected", (t1.headers.get("location") ?? "").includes("error=transaction_missing"));
    // Open-redirect attempts: the sign-in link must always point back to /dashboard.
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "https://evil.example",
      "javascript:alert(1)",
      "/%2F%2Fevil.example",
    ]) {
      const page = await (await tamper.request(`${APP}/login?returnTo=${encodeURIComponent(hostile)}`)).text();
      const href = decodeHtml(page.match(/href="(\/api\/auth\/login\?[^"]+)"/)?.[1] ?? "");
      const target = new URL(href || "/", APP).searchParams.get("returnTo") ?? "";
      const lands = new URL(target, APP);
      check(
        `hostile returnTo ${JSON.stringify(hostile)} stays on the app`,
        lands.origin === APP && !lands.pathname.startsWith("//"),
        target,
      );
    }
    const bc = await fetch(`${APP}/api/auth/backchannel-logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ logout_token: "eyJhbGciOiJub25lIn0.eyJzaWQiOiJ4In0." }),
    });
    check("unsigned back-channel logout token rejected", bc.status === 400);

    const audit = await db.query(
      `select a.event_type, a.outcome from trustguard.audit_events a
         join trustguard.users u on u.id = a.actor_user_id
        where u.username = $1 order by a.id`,
      [username],
    );
    console.log("\nAudit trail for the test user:");
    for (const row of audit.rows) console.log(`  ${row.event_type} (${row.outcome})`);
    check(
      "audit trail complete",
      ["auth.login.success", "auth.logout", "session.revoked"].every((t) =>
        audit.rows.some((r) => r.event_type === t),
      ),
    );
  } finally {
    await admin(`/users/${userId}`, { method: "DELETE" });
    await db.end();
    console.log(`\nDeleted temporary Keycloak user ${username}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
