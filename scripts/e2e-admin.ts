/**
 * End-to-end test for administrative controls (local development only;
 * app on :3000, Keycloak on :8080).
 *
 * Uses a temporary administrator and a temporary employee, signs both in through
 * the real Keycloak pages, then exercises every admin action over HTTP and checks
 * the effect in the app, in the database and in Keycloak itself.
 *
 * Usage:  npm run test:e2e:admin
 */
import { Client } from "pg";
import { APP, Browser, Checks, createTestUser, kcAdmin, login, nextTotpWindow } from "./lib/e2e";

const t = new Checks();
const check = t.check.bind(t);

/** Submit an admin action form like the browser does; returns the redirect target. */
async function act(b: Browser, action: string, target: string, returnTo = "/admin", origin = APP) {
  const res = await b.request(`${APP}/api/admin/actions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin },
    body: new URLSearchParams({ action, target, returnTo }),
  });
  // Return the redirect as a path, so checks do not depend on absolute vs relative URLs.
  const raw = res.headers.get("location") ?? "";
  return { status: res.status, location: raw.startsWith(APP) ? raw.slice(APP.length) : raw };
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const one = async (sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0];
  const appUser = (username: string) => one(`select * from trustguard.users where username = $1`, [username]);
  const latestSession = (username: string) =>
    one(
      `select s.* from trustguard.sessions s join trustguard.users u on u.id = s.user_id
        where u.username = $1 order by s.created_at desc limit 1`,
      [username],
    );

  const admin = await createTestUser(["tg-admin"], "e2e-admin");
  const employee = await createTestUser(["tg-employee"]);

  try {
    // -----------------------------------------------------------------------
    console.log("\n0. Sign-in (TOTP enrolment, then re-authentication)");
    const ab = new Browser();
    const eb = new Browser();
    const aEnrol = await login(ab, admin.username, admin.password, { enrol: true }, { returnTo: "/admin" });
    const eEnrol = await login(eb, employee.username, employee.password, { enrol: true });
    await nextTotpWindow();
    const aIn = await login(ab, admin.username, admin.password, { secret: aEnrol.totpSecret! }, { reauth: true, returnTo: "/admin" });
    const eIn = await login(eb, employee.username, employee.password, { secret: eEnrol.totpSecret! }, { reauth: true });
    check("admin reaches the admin console", aIn.finalUrl.pathname === "/admin", aIn.finalUrl.href);
    check("employee reaches the dashboard", eIn.finalUrl.pathname === "/dashboard", eIn.finalUrl.href);
    const adminRow = await appUser(admin.username);
    const empRow = await appUser(employee.username);

    // -----------------------------------------------------------------------
    console.log("\n1. Only administrators, only same-origin");
    const ePage = await eb.page("/admin/sessions");
    check("employee cannot open admin pages", ePage.status === 307 && ePage.location!.startsWith("/access-denied"));
    const eAct = await act(eb, "suspend_user", adminRow.id);
    check("employee cannot perform admin actions", eAct.status === 303 && eAct.location.includes("/access-denied?resource=admin.manage"), eAct.location);
    check("admin account untouched", !(await appUser(admin.username)).suspended_at);
    const csrf = await act(ab, "suspend_user", empRow.id, "/admin/users", "https://evil.example");
    check("cross-origin action rejected (403)", csrf.status === 403);
    for (const path of ["/admin", "/admin/sessions", "/admin/devices", "/admin/users", "/admin/audit"]) {
      const p = await ab.page(path);
      check(`admin page ${path} renders`, p.status === 200, `HTTP ${p.status}`);
    }
    check("sessions page lists the employee", (await ab.page("/admin/sessions")).body.includes(employee.username));

    // -----------------------------------------------------------------------
    console.log("\n2. Self-protection");
    const aSession = await latestSession(admin.username);
    check("cannot end own current session", (await act(ab, "revoke_session", aSession.id)).location.includes("error=self_session"));
    check("cannot suspend self", (await act(ab, "suspend_user", adminRow.id)).location.includes("error=self_suspend"));
    check("cannot block own device", (await act(ab, "block_device", aSession.device_id)).location.includes("error=self_device"));
    check("invalid target rejected", (await act(ab, "revoke_session", "not-a-uuid")).location.includes("error=invalid_request"));

    // -----------------------------------------------------------------------
    console.log("\n3. End a session (app + Keycloak)");
    const eSession = await latestSession(employee.username);
    const revoke = await act(ab, "revoke_session", eSession.id, "/admin/sessions");
    check("revoke succeeds with Keycloak in sync", revoke.location === "/admin/sessions?notice=session_revoked", revoke.location);
    check("employee is signed out immediately", (await eb.page("/dashboard")).status === 307);
    const s3 = await one(`select status, revoked_reason, revoked_by from trustguard.sessions where id = $1`, [eSession.id]);
    check("revocation attributed to the admin", s3.status === "revoked" && s3.revoked_reason === "admin_revoked" && s3.revoked_by === adminRow.id);
    const kcSessions = await (await kcAdmin(`/users/${employee.keycloakId}/sessions`)).json();
    check("Keycloak session ended too", Array.isArray(kcSessions) && kcSessions.length === 0, `${kcSessions.length} left`);
    const start = await eb.request(`${APP}/api/auth/login?returnTo=/dashboard`);
    const kcPage = await eb.follow(start.headers.get("location")!);
    check(
      "no silent SSO re-login: password + code required again",
      (await kcPage.res.text()).includes("kc-form-login"),
      kcPage.url.pathname,
    );

    // -----------------------------------------------------------------------
    console.log("\n4. Trust and block devices");
    const deviceId = eSession.device_id;
    check("trust device", (await act(ab, "trust_device", deviceId, "/admin/devices")).location.includes("notice=device_trusted"));
    const d4 = await one(`select status, status_changed_by from trustguard.devices where id = $1`, [deviceId]);
    check("device trusted, attributed to the admin", d4.status === "trusted" && d4.status_changed_by === adminRow.id);

    await nextTotpWindow();
    await login(eb, employee.username, employee.password, { secret: eEnrol.totpSecret! });
    const dash = await eb.page("/dashboard");
    check("employee sees the device as trusted", dash.status === 200 && dash.body.includes("Trusted by an administrator"));

    const block = await act(ab, "block_device", deviceId, "/admin/devices");
    check("block device", block.location.includes("notice=device_blocked") && !block.location.includes("warning"), block.location);
    check("blocked device's session ended", (await eb.page("/dashboard")).status === 307);

    await nextTotpWindow();
    const blockedLogin = await login(eb, employee.username, employee.password, { secret: eEnrol.totpSecret! });
    check("sign-in from a blocked device is denied", blockedLogin.finalUrl.pathname === "/access-denied", blockedLogin.finalUrl.href);
    check("denial explains DEVICE_BLOCKED", (await eb.page("/access-denied?resource=dashboard")).body.includes("DEVICE_BLOCKED"));
    check("reset device", (await act(ab, "reset_device", deviceId, "/admin/devices")).location.includes("notice=device_reset"));
    check("access restored after reset", (await eb.page("/dashboard")).status === 200);

    // -----------------------------------------------------------------------
    console.log("\n5. Suspend and reactivate a user");
    const suspend = await act(ab, "suspend_user", empRow.id, "/admin/users");
    check("suspend succeeds", suspend.location === "/admin/users?notice=user_suspended", suspend.location);
    const kcUser = await (await kcAdmin(`/users/${employee.keycloakId}`)).json();
    check("account disabled in Keycloak", kcUser.enabled === false);
    check("suspended user's session ended", (await eb.page("/dashboard")).status === 307);
    let refused = "";
    try {
      await nextTotpWindow();
      await login(eb, employee.username, employee.password, { secret: eEnrol.totpSecret! });
    } catch (err) {
      refused = (err as Error).message;
    }
    check("suspended user cannot sign in", /disabled/i.test(refused), refused.slice(0, 90));
    check("reactivate succeeds", (await act(ab, "reactivate_user", empRow.id, "/admin/users")).location.includes("notice=user_reactivated"));
    check("account enabled in Keycloak", (await (await kcAdmin(`/users/${employee.keycloakId}`)).json()).enabled === true);
    check("suspension cleared", !(await appUser(employee.username)).suspended_at);

    // -----------------------------------------------------------------------
    console.log("\n6. Admin actions require a fresher sign-in than viewing");
    // Trusting their own device removes NEW_DEVICE, so the admin is low risk and only the
    // age of the sign-in decides: viewing allows up to 60 minutes, actions only 30.
    check("admin can trust their own device", (await act(ab, "trust_device", aSession.device_id)).location.includes("notice=device_trusted"));
    await db.query(`update trustguard.sessions set created_at = now() - interval '31 minutes' where id = $1`, [aSession.id]);
    const stale = await act(ab, "suspend_user", empRow.id, "/admin/users");
    check("action redirected to step-up", stale.location.includes("/login?") && stale.location.includes("reason=step_up"), stale.location);
    check("nothing changed", !(await appUser(employee.username)).suspended_at);
    check("viewing still allowed (admin.console)", (await ab.page("/admin/users")).status === 200);
    await db.query(`update trustguard.sessions set created_at = now() where id = $1`, [aSession.id]);

    // -----------------------------------------------------------------------
    console.log("\n7. Audit log: filters and CSV export");
    const audit = await ab.page(`/admin/audit?type=admin.action&user=${admin.username}`);
    check("filtered audit page lists admin actions", audit.status === 200 && audit.body.includes("suspend_user") && audit.body.includes("block_device"));
    const expected = await one(
      `select count(*)::int as n from trustguard.audit_events where actor_user_id = $1 and event_type = 'admin.action'`,
      [adminRow.id],
    );
    const csv = await ab.request(`${APP}/api/admin/audit/export?type=admin.action&user=${admin.username}`);
    const text = await csv.text();
    const lines = text.trim().split("\r\n");
    check("CSV export served as an attachment", csv.headers.get("content-type")?.startsWith("text/csv") === true && (csv.headers.get("content-disposition") ?? "").includes("attachment"));
    check(
      "CSV has a header and one row per audited admin action",
      lines[0].startsWith('"id","occurred_at"') && lines.length - 1 === expected.n,
      `${lines.length - 1} rows, ${expected.n} in the database`,
    );
    check("employee cannot export", (await eb.request(`${APP}/api/admin/audit/export`)).status !== 200);
    const exported = await one(
      `select count(*)::int as n from trustguard.audit_events where actor_user_id = $1 and metadata->>'action' = 'export_audit'`,
      [adminRow.id],
    );
    check("the export itself is audited", exported.n >= 1);
    const failures = await one(
      `select count(*)::int as n from trustguard.audit_events where actor_user_id = $1 and event_type = 'admin.action' and outcome = 'failure'`,
      [adminRow.id],
    );
    // self_session, self_suspend, self_device and the malformed request.
    check("refused and malformed admin actions are audited as failures", failures.n === 4, `${failures.n}`);
  } finally {
    await employee.remove();
    await admin.remove();
    await db.end();
  }
  t.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
