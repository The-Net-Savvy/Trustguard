/**
 * Security evaluation: attack scenarios against the running stack (local only).
 *
 * Each scenario simulates an attack, records the control that should stop it and
 * the observed outcome:
 *   mitigated   the attack failed as intended
 *   vulnerable  the attack succeeded (a defect)
 *   limitation  the attack succeeds by design of the prototype; documented, not fixed
 *
 * Scenarios map to STRIDE threat categories and NIST SP 800-207 Zero Trust tenets.
 * Results are written to docs/evaluation/results/security.{json,md}.
 *
 * Usage (stack + app running):  npm run eval:security
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { Client } from "pg";
import {
  APP,
  Browser,
  createTestUser,
  decodeHtml,
  kcAdmin,
  keycloakError,
  login,
  nextTotpWindow,
  openSignIn,
  reportPosture,
  submitOtp,
  submitPassword,
  totp,
  type TestUser,
} from "./lib/e2e";

type Outcome = "mitigated" | "vulnerable" | "limitation";
type Stride = "Spoofing" | "Tampering" | "Repudiation" | "Information disclosure" | "Denial of service" | "Elevation of privilege";

interface Scenario {
  id: string;
  title: string;
  stride: Stride;
  /** NIST SP 800-207 section 2.1 tenet numbers. */
  tenets: number[];
  attack: string;
  control: string;
  outcome: Outcome;
  evidence: string;
}

const results: Scenario[] = [];

async function scenario(
  meta: Omit<Scenario, "outcome" | "evidence">,
  run: () => Promise<{ outcome: Outcome; evidence: string }>,
) {
  let r: { outcome: Outcome; evidence: string };
  try {
    r = await run();
  } catch (err) {
    r = { outcome: "vulnerable", evidence: `scenario error: ${(err as Error).message}` };
  }
  results.push({ ...meta, ...r });
  const tag = { mitigated: "MITIGATED ", vulnerable: "VULNERABLE", limitation: "LIMITATION" }[r.outcome];
  console.log(`  ${tag}  ${meta.id} ${meta.title}\n              ${r.evidence}`);
}

const mitigated = (ok: boolean, evidence: string) => ({ outcome: (ok ? "mitigated" : "vulnerable") as Outcome, evidence });

/** A browser that records what the app sends it (bodies and Set-Cookie headers). */
class RecordingBrowser extends Browser {
  seen: { url: string; setCookie: string[]; body: string }[] = [];
  override async request(url: string | URL, init: RequestInit = {}) {
    const res = await super.request(url, init);
    if (new URL(url).origin === APP) {
      this.seen.push({ url: String(url), setCookie: res.headers.getSetCookie(), body: await res.clone().text() });
    }
    return res;
  }
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const one = async (sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows[0];
  const latestSession = (username: string) =>
    one(
      `select s.* from trustguard.sessions s join trustguard.users u on u.id = s.user_id
        where u.username = $1 order by s.created_at desc limit 1`,
      [username],
    );

  const users: TestUser[] = [];
  const employee = await createTestUser(["tg-employee"], "eval");
  const admin = await createTestUser(["tg-admin"], "eval-admin");
  users.push(employee, admin);

  try {
    // ---- Setup: both users enrol TOTP and sign in --------------------------------
    console.log("\nSetup: enrolment and sign-in for an employee and an administrator");
    const eb = new Browser();
    const ab = new Browser();
    const eEnrol = await login(eb, employee.username, employee.password, { enrol: true });
    const aEnrol = await login(ab, admin.username, admin.password, { enrol: true }, { returnTo: "/admin" });
    await nextTotpWindow();
    await login(eb, employee.username, employee.password, { secret: eEnrol.totpSecret! }, { reauth: true });
    await login(ab, admin.username, admin.password, { secret: aEnrol.totpSecret! }, { reauth: true, returnTo: "/admin" });
    const empSecret = eEnrol.totpSecret!;
    const adminSecret = aEnrol.totpSecret!;
    const adminRow = await one(`select id from trustguard.users where username = $1`, [admin.username]);
    const empRow = await one(`select id from trustguard.users where username = $1`, [employee.username]);
    console.log("\nScenarios");

    // ---- Identity -------------------------------------------------------------------
    await scenario(
      {
        id: "S01",
        title: "Stolen password, no second factor",
        stride: "Spoofing",
        tenets: [6],
        attack: "Attacker knows an enrolled user's password and guesses the one-time code.",
        control: "Keycloak browser flow requires password AND OTP; the app also requires amr to contain a second factor.",
      },
      async () => {
        const atk = new Browser();
        const otpPage = await submitPassword(atk, await openSignIn(atk), admin.username, admin.password);
        const res = await submitOtp(atk, otpPage, "000000");
        const blocked = res.status === 200 && !atk.get("tg_session") && (await atk.page("/dashboard")).status === 307;
        return mitigated(blocked, `wrong code answered with HTTP ${res.status} "${keycloakError(await res.text()) ?? ""}"; no app session issued`);
      },
    );

    await scenario(
      {
        id: "S02",
        title: "Online brute force of the one-time code",
        stride: "Spoofing",
        tenets: [6, 7],
        attack: "Attacker with the password submits many one-time codes.",
        control: "Keycloak brute-force detection: temporary lockout after 5 failures (60 s, growing to 15 min).",
      },
      async () => {
        const atk = new Browser();
        let page = await submitPassword(atk, await openSignIn(atk), admin.username, admin.password);
        for (let i = 0; i < 5 && page.includes("kc-otp-login-form"); i++) {
          page = await (await submitOtp(atk, page, String(100000 + i))).text();
        }
        const status = await (await kcAdmin(`/attack-detection/brute-force/users/${admin.keycloakId}`)).json();
        // Even the correct password + current code is refused while locked.
        const retry = new Browser();
        const afterPw = await submitPassword(retry, await openSignIn(retry), admin.username, admin.password);
        const stillLocked = !afterPw.includes("kc-otp-login-form") || (await submitOtp(retry, afterPw, totp(adminSecret))).status !== 302;
        await kcAdmin(`/attack-detection/brute-force/users/${admin.keycloakId}`, { method: "DELETE" });
        return mitigated(
          status.disabled === true && stillLocked,
          `account locked after ${status.numFailures} rapid failures (disabled=${status.disabled}, quick-login detection); correct credentials refused while locked; lockout cleared afterwards`,
        );
      },
    );

    await scenario(
      {
        id: "S03",
        title: "Attacker enrols their own authenticator on a new account",
        stride: "Spoofing",
        tenets: [6],
        attack: "Attacker obtains a new user's initial password before the user's first sign-in and completes TOTP enrolment.",
        control: "None in the prototype: first sign-in trusts whoever holds the initial password (trust-on-first-use).",
      },
      async () => {
        const fresh = await createTestUser(["tg-employee"], "eval-new");
        users.push(fresh);
        const atk = new Browser();
        const enrolled = await login(atk, fresh.username, fresh.password, { enrol: true });
        const creds = (await (await kcAdmin(`/users/${fresh.keycloakId}/credentials`)).json()) as { type: string }[];
        const hijacked = enrolled.finalUrl.searchParams.get("error") === "mfa_required" && creds.some((c) => c.type === "otp");
        return {
          outcome: hijacked ? "limitation" : "mitigated",
          evidence: hijacked
            ? "attacker's authenticator was registered on the account. Mitigation: deliver initial passwords out of band as temporary, or use enrolment links"
            : "enrolment was not possible",
        };
      },
    );

    // ---- Login flow integrity -------------------------------------------------------
    await scenario(
      {
        id: "S04",
        title: "Tampered OAuth state on the callback",
        stride: "Tampering",
        tenets: [6],
        attack: "Attacker sends the victim a callback URL with a forged state/code (login CSRF).",
        control: "state, nonce and PKCE verifier are bound to an encrypted, short-lived transaction cookie.",
      },
      async () => {
        const atk = new Browser();
        await openSignIn(atk); // obtains a genuine transaction cookie
        const res = await atk.request(`${APP}/api/auth/callback?code=forged&state=forged`);
        const loc = res.headers.get("location") ?? "";
        return mitigated(loc.includes("error=token_exchange_failed") && !atk.get("tg_session"), `callback answered ${res.status} -> ${loc.replace(APP, "")}`);
      },
    );

    // ---- Session security -----------------------------------------------------------
    await scenario(
      {
        id: "S05",
        title: "Cross-site request forgery",
        stride: "Tampering",
        tenets: [6],
        attack: "A malicious site makes the admin's browser POST to logout, admin actions and the posture API.",
        control: "Origin check on every state-changing endpoint, plus SameSite=Lax session cookie.",
      },
      async () => {
        const evil = { origin: "https://evil.example" };
        const codes = [
          (await ab.request(`${APP}/api/auth/logout`, { method: "POST", headers: evil })).status,
          (await ab.request(`${APP}/api/admin/actions`, {
            method: "POST",
            headers: { ...evil, "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ action: "suspend_user", target: empRow.id, returnTo: "/admin" }),
          })).status,
          (await ab.request(`${APP}/api/device/posture`, { method: "POST", headers: { ...evil, "content-type": "application/json" }, body: "{}" })).status,
        ];
        const empOk = !(await one(`select suspended_at from trustguard.users where id = $1`, [empRow.id])).suspended_at;
        return mitigated(codes.every((c) => c === 403) && empOk, `logout/admin/posture answered ${codes.join("/")}; target account unchanged`);
      },
    );

    await scenario(
      {
        id: "S06",
        title: "Open redirect after sign-in",
        stride: "Spoofing",
        tenets: [6],
        attack: "Phishing link with returnTo pointing to another site (incl. tab/newline and backslash tricks).",
        control: "returnTo is resolved against the app origin; anything off-origin becomes /dashboard.",
      },
      async () => {
        const hostile = ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "https://evil.example", "javascript:alert(1)"];
        const atk = new Browser();
        const escaped: string[] = [];
        for (const h of hostile) {
          const html = await (await atk.request(`${APP}/login?returnTo=${encodeURIComponent(h)}`)).text();
          const href = decodeHtml(html.match(/href="(\/api\/auth\/login\?[^"]+)"/)?.[1] ?? "");
          const target = new URL(new URL(href, APP).searchParams.get("returnTo") ?? "", APP);
          if (target.origin !== APP) escaped.push(h);
        }
        return mitigated(escaped.length === 0, `${hostile.length} hostile values tried, ${escaped.length} escaped the app`);
      },
    );

    await scenario(
      {
        id: "S07",
        title: "Privilege escalation by an employee",
        stride: "Elevation of privilege",
        tenets: [3, 4, 6],
        attack: "Employee opens admin pages, posts admin actions and requests the audit export.",
        control: "Deny-by-default policy engine; admin.console / admin.manage require the tg-admin role from Keycloak.",
      },
      async () => {
        const page = await eb.page("/admin/users");
        const act = await eb.request(`${APP}/api/admin/actions`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "suspend_user", target: adminRow.id, returnTo: "/admin" }),
        });
        const exp = await eb.request(`${APP}/api/admin/audit/export`);
        const ok = page.status === 307 && (act.headers.get("location") ?? "").includes("access-denied") && exp.status !== 200;
        return mitigated(ok, `admin page -> ${page.status} ${page.location}; action -> access-denied; export -> ${exp.status}`);
      },
    );

    // ---- Device posture -------------------------------------------------------------
    const postureScenario = async (
      id: string,
      title: string,
      attack: string,
      overrides: Parameters<typeof reportPosture>[1],
      expectReason: string,
    ) =>
      scenario(
        { id, title, stride: "Spoofing", tenets: [4, 5], attack, control: "Device posture is re-reported and evaluated on every request; policy denies." },
        async () => {
          await reportPosture(eb, overrides);
          const page = await eb.page("/dashboard");
          const dec = await one(
            `select a.metadata from trustguard.audit_events a join trustguard.users u on u.id = a.actor_user_id
              where u.username = $1 and a.event_type = 'access.decision' and a.resource = 'dashboard' order by a.id desc limit 1`,
            [employee.username],
          );
          await reportPosture(eb);
          const restored = (await eb.page("/dashboard")).status === 200;
          return mitigated(
            page.status === 307 && dec?.metadata.reason === expectReason && restored,
            `dashboard -> ${page.status}, decision ${dec?.metadata.reason} (risk ${dec?.metadata.riskScore}); access restored once the device was healthy`,
          );
        },
      );
    await postureScenario("S08", "Automated browser (bot) inside a valid session", "Session is driven by automation (navigator.webdriver).", { webdriver: true }, "DENY_SIGNAL");
    await postureScenario("S09", "Forged posture report", "Client reports a different browser than it actually uses.", { userAgent: "Mozilla/5.0 (Macintosh) Safari/605.1.15" }, "DENY_SIGNAL");
    await postureScenario(
      "S10",
      "Non-compliant device",
      "Outdated browser on a page without a secure context.",
      { secureContext: false, brands: [{ brand: "Google Chrome", version: "109.0.0.0" }] },
      "RISK_TOO_HIGH",
    );

    // ---- Token and data protection ---------------------------------------------------
    await scenario(
      {
        id: "S11",
        title: "Forged back-channel logout",
        stride: "Denial of service",
        tenets: [6],
        attack: "Attacker posts logout tokens (unsigned, and signed with their own key) to end a victim's session.",
        control: "Logout tokens must be signed by the realm key (JWKS), with correct issuer, audience, event and age.",
      },
      async () => {
        const victim = await latestSession(employee.username);
        const { privateKey, publicKey } = await generateKeyPair("RS256");
        const kid = (await exportJWK(publicKey)).n!.slice(0, 16);
        const forged = await new SignJWT({ sid: victim.idp_session_id, events: { "http://schemas.openid.net/event/backchannel-logout": {} } })
          .setProtectedHeader({ alg: "RS256", kid })
          .setIssuer(process.env.KEYCLOAK_ISSUER!)
          .setAudience(process.env.KEYCLOAK_CLIENT_ID ?? "trust-guard-bff")
          .setIssuedAt()
          .setJti(crypto.randomUUID())
          .sign(privateKey);
        const post = (token: string) =>
          fetch(`${APP}/api/auth/backchannel-logout`, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ logout_token: token }),
          }).then((r) => r.status);
        const codes = [await post("eyJhbGciOiJub25lIn0.eyJzaWQiOiJ4In0."), await post(forged)];
        const still = (await one(`select status from trustguard.sessions where id = $1`, [victim.id])).status;
        return mitigated(codes.every((c) => c === 400) && still === "active", `unsigned -> ${codes[0]}, attacker-signed -> ${codes[1]}; victim session ${still}`);
      },
    );

    await scenario(
      {
        id: "S12",
        title: "Database leak exposes usable sessions or tokens",
        stride: "Information disclosure",
        tenets: [2],
        attack: "Attacker reads the sessions table (e.g. backup leak) and tries to reuse what is stored.",
        control: "Only SHA-256 hashes of session ids are stored; Keycloak tokens are AES-256-GCM encrypted.",
      },
      async () => {
        const cookie = eb.get("tg_session")!;
        const row = await one(`select encode(id_hash, 'hex') as h, tokens_encrypted from trustguard.sessions where id = (select s.id from trustguard.sessions s join trustguard.users u on u.id = s.user_id where u.username = $1 order by s.created_at desc limit 1)`, [employee.username]);
        const plain = await one(`select count(*)::int as n from trustguard.sessions where tokens_encrypted ~ 'eyJ[A-Za-z0-9_-]{10,}[.]' or encode(id_hash, 'escape') like $1`, [`%${cookie}%`]);
        const total = await one(`select count(*)::int as n from trustguard.sessions`);
        const replay = new Browser();
        replay.set("tg_session", row.h);
        const replayStatus = (await replay.page("/dashboard")).status;
        return mitigated(
          plain.n === 0 && replayStatus === 307,
          `${plain.n} of ${total.n} stored sessions contain a raw JWT or cookie value; presenting the stored hash as a cookie -> ${replayStatus}`,
        );
      },
    );

    await scenario(
      {
        id: "S13",
        title: "Tampering with the audit trail",
        stride: "Repudiation",
        tenets: [7],
        attack: "An insider with application-level database access edits or deletes audit records.",
        control: "Trigger makes trustguard.audit_events append-only (UPDATE and DELETE raise errors).",
      },
      async () => {
        const errors: string[] = [];
        for (const sql of [
          `update trustguard.audit_events set outcome = 'allow' where id = (select max(id) from trustguard.audit_events)`,
          `delete from trustguard.audit_events where id = (select max(id) from trustguard.audit_events)`,
        ]) {
          try {
            await db.query(sql);
          } catch (err) {
            errors.push((err as Error).message);
          }
        }
        return mitigated(errors.length === 2, `UPDATE and DELETE rejected: "${errors[0] ?? "allowed!"}". (A database owner could still drop the trigger.)`);
      },
    );

    await scenario(
      {
        id: "S14",
        title: "Spoofed client IP address",
        stride: "Spoofing",
        tenets: [4, 7],
        attack: "Client sends a forged X-Forwarded-For header to choose the IP the app sees.",
        control: "Only effective behind a reverse proxy that overwrites X-Forwarded-For (not part of the prototype).",
      },
      async () => {
        await eb.request(`${APP}/api/device/posture`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
          body: JSON.stringify((await import("./lib/e2e")).posture(eb)),
        });
        const dev = await one(`select host(last_ip) as ip from trustguard.devices where id = (select device_id from trustguard.sessions where id = $1)`, [(await latestSession(employee.username)).id]);
        await reportPosture(eb);
        return {
          outcome: dev.ip === "198.51.100.77" ? "limitation" : "mitigated",
          evidence: `app recorded the attacker-chosen IP ${dev.ip}; IP-based signals are only trustworthy behind a proxy`,
        };
      },
    );

    // ---- Time-based controls ----------------------------------------------------------
    await scenario(
      {
        id: "S15",
        title: "Admin action from an old sign-in",
        stride: "Elevation of privilege",
        tenets: [3, 6],
        attack: "Someone uses an admin's unattended browser 31 minutes after sign-in to suspend a user.",
        control: "admin.manage policy: actions need a sign-in under 30 minutes old (step-up otherwise).",
      },
      async () => {
        const s = await latestSession(admin.username);
        await db.query(`update trustguard.sessions set created_at = now() - interval '31 minutes' where id = $1`, [s.id]);
        const res = await ab.request(`${APP}/api/admin/actions`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "suspend_user", target: empRow.id, returnTo: "/admin/users" }),
        });
        await db.query(`update trustguard.sessions set created_at = now() where id = $1`, [s.id]);
        const untouched = !(await one(`select suspended_at from trustguard.users where id = $1`, [empRow.id])).suspended_at;
        return mitigated((res.headers.get("location") ?? "").includes("reason=step_up") && untouched, `action redirected to step-up re-authentication; user not suspended`);
      },
    );

    await scenario(
      {
        id: "S16",
        title: "Abandoned session reused later",
        stride: "Spoofing",
        tenets: [3],
        attack: "A session left idle for 2 hours is picked up again.",
        control: "30-minute sliding idle timeout and 8-hour absolute lifetime, enforced server-side.",
      },
      async () => {
        const s = await latestSession(employee.username);
        await db.query(`update trustguard.sessions set last_seen_at = now() - interval '2 hours' where id = $1`, [s.id]);
        const status = (await eb.page("/dashboard")).status;
        const row = await one(`select status, revoked_reason from trustguard.sessions where id = $1`, [s.id]);
        return mitigated(status === 307 && row.revoked_reason === "idle_timeout", `request -> ${status}; session ${row.status} (${row.revoked_reason})`);
      },
    );

    // ---- Session theft, fixation and code replay (fresh sign-in) ------------------------
    await nextTotpWindow();
    const victim = new RecordingBrowser();
    const planted = "attacker-chosen-session-id-0123456789abcdef";
    victim.set("tg_session", planted);
    const pwPage = await submitPassword(victim, await openSignIn(victim), employee.username, employee.password);
    const otpRes = await submitOtp(victim, pwPage, totp(empSecret));
    const callbackUrl = otpRes.headers.get("location")!;
    const done = await victim.follow(callbackUrl);
    if (done.url.pathname === "/verify-device") {
      await reportPosture(victim);
      await victim.follow(new URL(done.url.searchParams.get("returnTo") ?? "/dashboard", APP));
    }

    await scenario(
      {
        id: "S17",
        title: "Session fixation",
        stride: "Spoofing",
        tenets: [3],
        attack: "Attacker plants a known session cookie in the victim's browser before the victim signs in.",
        control: "A new random session id is issued at every sign-in; the planted value is never a valid session.",
      },
      async () => {
        const after = victim.get("tg_session");
        const atk = new Browser();
        atk.set("tg_session", planted);
        const status = (await atk.page("/dashboard")).status;
        return mitigated(!!after && after !== planted && status === 307, `victim received a new session id; planted cookie -> ${status}`);
      },
    );

    await scenario(
      {
        id: "S18",
        title: "Authorization code replay",
        stride: "Spoofing",
        tenets: [6],
        attack: "Attacker captures the victim's callback URL (code + state) and replays it.",
        control: "Code is bound to the victim's transaction cookie and PKCE verifier, and is single-use at Keycloak.",
      },
      async () => {
        const atk = new Browser();
        const r1 = (await atk.request(callbackUrl)).headers.get("location") ?? "";
        const r2 = (await victim.request(callbackUrl)).headers.get("location") ?? "";
        return mitigated(
          r1.includes("error=") && r2.includes("error=") && !atk.get("tg_session"),
          `replay from attacker -> ${r1.replace(APP, "")}; replay in victim's browser -> ${r2.replace(APP, "")}`,
        );
      },
    );

    await scenario(
      {
        id: "S19",
        title: "Tokens exposed to the browser (XSS impact)",
        stride: "Information disclosure",
        tenets: [2],
        attack: "Script injected into a page tries to read access/refresh/ID tokens or the session cookie.",
        control: "BFF pattern: tokens never leave the server; the session cookie is HttpOnly and SameSite=Lax.",
      },
      async () => {
        const jwt = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./;
        const leaks = victim.seen.filter((s) => jwt.test(s.body) || s.setCookie.some((c) => jwt.test(c)));
        const sessionCookie = victim.seen.flatMap((s) => s.setCookie).find((c) => c.startsWith("tg_session=") && !c.startsWith("tg_session=;")) ?? "";
        const flags = /HttpOnly/i.test(sessionCookie) && /SameSite=lax/i.test(sessionCookie);
        return mitigated(
          leaks.length === 0 && flags,
          `${victim.seen.length} app responses during sign-in, ${leaks.length} contained a JWT; session cookie HttpOnly + SameSite=Lax: ${flags}`,
        );
      },
    );

    await scenario(
      {
        id: "S20",
        title: "Stolen session cookie used from another device",
        stride: "Spoofing",
        tenets: [3, 4, 5],
        attack: "Attacker copies the victim's session cookie (malware, shared PC) into their own browser.",
        control: "Sessions are bound to the device cookie of the browser that verified posture; mismatch revokes the session.",
      },
      async () => {
        const thief = new Browser();
        thief.set("tg_session", victim.get("tg_session")!);
        const page = await thief.page("/dashboard");
        const s = await latestSession(employee.username);
        return mitigated(
          page.location === "/login?error=device_mismatch" && s.revoked_reason === "device_mismatch",
          `thief -> ${page.status} ${page.location}; session ${s.status} (${s.revoked_reason}), victim must sign in again`,
        );
      },
    );

    // ---- Administrative response ------------------------------------------------------
    await nextTotpWindow();
    const eb2 = new Browser();
    await login(eb2, employee.username, employee.password, { secret: empSecret });
    await scenario(
      {
        id: "S21",
        title: "Revoked user signs straight back in via SSO",
        stride: "Elevation of privilege",
        tenets: [3, 6],
        attack: "After an admin ends their session, the user relies on Keycloak's SSO cookie to get back in silently.",
        control: "Ending a session also ends the Keycloak SSO session via the least-privilege service account.",
      },
      async () => {
        const s = await latestSession(employee.username);
        await ab.request(`${APP}/api/admin/actions`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "revoke_session", target: s.id, returnTo: "/admin/sessions" }),
        });
        const html = await openSignIn(eb2);
        return mitigated(html.includes("kc-form-login"), `after revocation the sign-in shows the password form again (no silent SSO)`);
      },
    );

    await scenario(
      {
        id: "S22",
        title: "Suspended employee keeps working",
        stride: "Elevation of privilege",
        tenets: [3, 6],
        attack: "A suspended user (e.g. leaving the company) tries to continue or sign in again.",
        control: "Suspension disables the Keycloak account first, then ends every session.",
      },
      async () => {
        await ab.request(`${APP}/api/admin/actions`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "suspend_user", target: empRow.id, returnTo: "/admin/users" }),
        });
        const page = await submitPassword(eb2, await openSignIn(eb2), employee.username, employee.password);
        const err = keycloakError(page) ?? "";
        await ab.request(`${APP}/api/admin/actions`, {
          method: "POST",
          headers: { origin: APP, "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ action: "reactivate_user", target: empRow.id, returnTo: "/admin/users" }),
        });
        return mitigated(/disabled/i.test(err) && !page.includes("kc-otp-login-form"), `sign-in refused by Keycloak: "${err}" (account reactivated afterwards)`);
      },
    );
  } finally {
    for (const u of users) await u.remove().catch(() => {});
    await db.end();
  }

  // ---- Report ---------------------------------------------------------------------------
  const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
  const md = [
    `# Security evaluation results`,
    ``,
    `Generated by \`npm run eval:security\` on ${new Date().toISOString()}.`,
    ``,
    `**${results.length} scenarios: ${counts.mitigated ?? 0} mitigated, ${counts.vulnerable ?? 0} vulnerable, ${counts.limitation ?? 0} known limitations.**`,
    ``,
    `| ID | Scenario | STRIDE | NIST tenets | Control | Outcome | Evidence |`,
    `|---|---|---|---|---|---|---|`,
    ...results.map(
      (r) =>
        `| ${r.id} | **${r.title}**<br>${r.attack} | ${r.stride} | ${r.tenets.join(", ")} | ${r.control} | ${
          { mitigated: "✅ Mitigated", vulnerable: "❌ Vulnerable", limitation: "⚠️ Limitation" }[r.outcome]
        } | ${r.evidence.replace(/\|/g, "\\|")} |`,
    ),
    ``,
  ].join("\n");
  mkdirSync("docs/evaluation/results", { recursive: true });
  writeFileSync("docs/evaluation/results/security.json", JSON.stringify({ generatedAt: new Date().toISOString(), counts, results }, null, 2) + "\n");
  writeFileSync("docs/evaluation/results/security.md", md);
  console.log(`\n${results.length} scenarios: ${JSON.stringify(counts)}. Written to docs/evaluation/results/security.{json,md}`);
  process.exit(counts.vulnerable ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
