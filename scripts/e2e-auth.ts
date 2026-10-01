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
import { Client } from "pg";
import { APP, Browser, Checks, createTestUser, decodeHtml, kcAdmin, login, nextTotpWindow } from "./lib/e2e";

const t = new Checks();
const check = t.check.bind(t);
const dashboardStatus = (b: Browser) => b.page("/dashboard");

// ---------------------------------------------------------------------------
// Test run
// ---------------------------------------------------------------------------
async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();

  const user = await createTestUser(["tg-employee"]);
  const { username, password, keycloakId: userId } = user;

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
    await kcAdmin(`/users/${userId}/logout`, { method: "POST" });
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
      ["auth.login.success", "auth.logout", "session.revoked"].every((type) =>
        audit.rows.some((r) => r.event_type === type),
      ),
    );
  } finally {
    await user.remove();
    await db.end();
  }

  t.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
