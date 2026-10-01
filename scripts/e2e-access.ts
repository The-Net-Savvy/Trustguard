/**
 * End-to-end test for device posture, risk scoring and the policy engine
 * (local development only; app on :3000, Keycloak on :8080).
 *
 * Uses two temporary Keycloak users (an employee and an administrator) and drives
 * the real login pages, the posture API and the protected pages over HTTP.
 * Session ages and posture timestamps are moved in the database to test time-based
 * rules without waiting.
 *
 * Usage:  npm run test:e2e:access
 */
import { Client } from "pg";
import { isOffHours, parseDays } from "@/server/risk-engine/context";
import { APP, Browser, Checks, createTestUser, login, nextTotpWindow, reportPosture } from "./lib/e2e";

const t = new Checks();
const check = t.check.bind(t);

const offHoursNow = () =>
  isOffHours(new Date(), {
    timeZone: process.env.BUSINESS_TIMEZONE ?? "Africa/Lagos",
    hours: process.env.BUSINESS_HOURS ?? "07:00-19:00",
    days: parseDays(process.env.BUSINESS_DAYS ?? "1-5"),
  });

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const latestSession = async (username: string) =>
    (
      await db.query(
        `select s.* from trustguard.sessions s join trustguard.users u on u.id = s.user_id
          where u.username = $1 order by s.created_at desc limit 1`,
        [username],
      )
    ).rows[0];
  const lastDecision = async (username: string, resource: string) =>
    (
      await db.query(
        `select a.outcome, a.metadata from trustguard.audit_events a join trustguard.users u on u.id = a.actor_user_id
          where u.username = $1 and a.event_type = 'access.decision' and a.resource = $2
          order by a.id desc limit 1`,
        [username, resource],
      )
    ).rows[0];

  console.log(`Business hours now: ${offHoursNow() ? "no (OFF_HOURS adds +10)" : "yes"}`);
  const employee = await createTestUser(["tg-employee"]);
  const admin = await createTestUser(["tg-admin"], "e2e-admin");

  try {
    // -----------------------------------------------------------------------
    console.log("\n1. Sign-in requires device verification");
    const eb = new Browser();
    const enrol = await login(eb, employee.username, employee.password, { enrol: true });
    await nextTotpWindow();
    const first = await login(eb, employee.username, employee.password, { secret: enrol.totpSecret! }, { reauth: true });
    check("app asked to verify the device after sign-in", first.verifiedDevice);
    check("dashboard reached after posture report", first.finalUrl.pathname === "/dashboard", first.finalUrl.href);
    check("device cookie issued", !!eb.get("tg_device"));
    const s1 = await latestSession(employee.username);
    const dev = (await db.query(`select * from trustguard.devices where id = $1`, [s1.device_id])).rows[0];
    check("session bound to a registered device", !!dev && dev.status === "registered");
    check("device labelled from posture", dev?.label === "Chrome 141 on Windows 11", dev?.label);
    const d1 = await eb.page("/dashboard");
    check("dashboard shows the new-device signal", d1.status === 200 && d1.body.includes("First session from this device"));

    // -----------------------------------------------------------------------
    console.log("\n2. Least privilege");
    const a1 = await eb.page("/admin");
    check("employee is redirected away from /admin", a1.status === 307 && !!a1.location?.startsWith("/access-denied"), a1.location ?? "");
    const denied = await eb.page(a1.location!);
    check("access-denied page explains ROLE_REQUIRED", denied.status === 200 && denied.body.includes("ROLE_REQUIRED"));
    const dec1 = await lastDecision(employee.username, "admin.console");
    check("deny decision audited", dec1?.outcome === "deny" && dec1?.metadata.reason === "ROLE_REQUIRED");

    // -----------------------------------------------------------------------
    console.log("\n3. Continuous posture verification");
    await reportPosture(eb, { webdriver: true });
    const d2 = await eb.page("/dashboard");
    check("automation detected mid-session -> denied", d2.status === 307 && !!d2.location?.startsWith("/access-denied"));
    const dec2 = await lastDecision(employee.username, "dashboard");
    check("denied by hard-deny signal", dec2?.metadata.reason === "DENY_SIGNAL" && dec2?.metadata.signals.includes("AUTOMATION_DETECTED"));

    await reportPosture(eb, { secureContext: false, brands: [{ brand: "Google Chrome", version: "109.0.0.0" }] });
    const d3 = await eb.page("/dashboard");
    const dec3 = await lastDecision(employee.username, "dashboard");
    check("insecure context + outdated browser + new device -> high risk denied", d3.status === 307 && dec3?.metadata.reason === "RISK_TOO_HIGH", `score ${dec3?.metadata.riskScore}`);

    await reportPosture(eb);
    check("healthy posture restores access", (await eb.page("/dashboard")).status === 200);

    // -----------------------------------------------------------------------
    console.log("\n4. Network change");
    const d4 = await eb.request(`${APP}/dashboard`, { headers: { "x-forwarded-for": "203.0.113.9" } });
    const body4 = await d4.text();
    check(
      "IP change since sign-in raises risk (simulated via X-Forwarded-For)",
      d4.status === 200 && body4.includes("IP address changed since sign-in"),
      `HTTP ${d4.status}`,
    );

    // -----------------------------------------------------------------------
    console.log("\n5. Stale posture is re-collected");
    await db.query(`update trustguard.sessions set posture_at = now() - interval '11 minutes' where id = $1`, [s1.id]);
    const d5 = await eb.page("/dashboard");
    check("stale posture redirects to /verify-device", d5.status === 307 && !!d5.location?.startsWith("/verify-device"), d5.location ?? "");
    await reportPosture(eb);
    check("fresh report restores access", (await eb.page("/dashboard")).status === 200);

    // -----------------------------------------------------------------------
    console.log("\n6. Stolen session cookie");
    const thief = new Browser();
    thief.set("tg_session", eb.get("tg_session")!);
    const stolen = await thief.page("/dashboard");
    check("session used from another device is rejected", stolen.status === 307 && stolen.location === "/login?error=device_mismatch", stolen.location ?? "");
    const s6 = await latestSession(employee.username);
    check("session revoked (device_mismatch)", s6.status === "revoked" && s6.revoked_reason === "device_mismatch");
    check("legitimate browser is signed out too", (await eb.page("/dashboard")).status === 307);

    // -----------------------------------------------------------------------
    console.log("\n7. Concurrent first posture reports (regression: React runs effects twice in dev)");
    await nextTotpWindow();
    const cb = new Browser();
    const fresh = await login(cb, employee.username, employee.password, { secret: enrol.totpSecret! }, { verifyDevice: false });
    check("device cookie issued at sign-in", fresh.finalUrl.pathname === "/verify-device" && !!cb.get("tg_device"));
    const [r1, r2] = await Promise.all([reportPosture(cb), reportPosture(cb)]);
    check("both concurrent reports accepted", r1.status === 200 && r2.status === 200, `${r1.status}/${r2.status}`);
    check("session survives concurrent reports", (await cb.page("/dashboard")).status === 200);

    // -----------------------------------------------------------------------
    console.log("\n8. Administrator: risk-based step-up");
    const ab = new Browser();
    const aEnrol = await login(ab, admin.username, admin.password, { enrol: true }, { returnTo: "/admin" });
    await nextTotpWindow();
    // Windows 10 (end of support) + new device (+ off-hours) -> medium risk.
    const aFirst = await login(
      ab,
      admin.username,
      admin.password,
      { secret: aEnrol.totpSecret! },
      { reauth: true, returnTo: "/admin", posture: { platformVersion: "10.0.0" } },
    );
    const decA1 = await lastDecision(admin.username, "admin.console");
    check(
      "medium risk allowed right after sign-in",
      aFirst.finalUrl.pathname === "/admin" && decA1?.metadata.reason === "STEP_UP_SATISFIED",
      `${aFirst.finalUrl.pathname}, ${decA1?.metadata.reason}, score ${decA1?.metadata.riskScore}`,
    );

    const sa = await latestSession(admin.username);
    await db.query(`update trustguard.sessions set created_at = now() - interval '15 minutes' where id = $1`, [sa.id]);
    const a2 = await ab.page("/admin");
    check("medium risk + sign-in older than 10 min -> step-up", a2.status === 307 && !!a2.location?.includes("reason=step_up"), a2.location ?? "");
    check("dashboard (allows medium) still accessible", (await ab.page("/dashboard")).status === 200);
    const stepUpPage = await ab.page(a2.location!);
    check("login page offers re-authentication", stepUpPage.body.includes("reauth=1") && stepUpPage.body.includes("Additional verification"));

    await nextTotpWindow();
    const aStep = await login(ab, admin.username, admin.password, { secret: aEnrol.totpSecret! }, { reauth: true, returnTo: "/admin" });
    const decA2 = await lastDecision(admin.username, "admin.console");
    check(
      "after step-up the admin console opens",
      aStep.finalUrl.pathname === "/admin" && decA2?.outcome === "allow",
      `${aStep.finalUrl.pathname}, signals ${decA2?.metadata.signals}`,
    );
    check("device no longer counts as new", !decA2?.metadata.signals.includes("NEW_DEVICE"));
    const old = (await db.query(`select status, revoked_reason from trustguard.sessions where id = $1`, [sa.id])).rows[0];
    check("previous session replaced", old.status === "revoked" && old.revoked_reason === "replaced_by_new_login");

    const sb = await latestSession(admin.username);
    await db.query(`update trustguard.sessions set created_at = now() - interval '61 minutes' where id = $1`, [sb.id]);
    const a3 = await ab.page("/admin");
    const decA3 = await lastDecision(admin.username, "admin.console");
    check("low risk but sign-in older than 60 min -> step-up", a3.status === 307 && decA3?.metadata.reason === "REAUTH_REQUIRED", decA3?.metadata.reason);

    // -----------------------------------------------------------------------
    const audit = await db.query(
      `select a.event_type, a.outcome, a.resource, a.metadata->>'reason' as reason
         from trustguard.audit_events a join trustguard.users u on u.id = a.actor_user_id
        where u.username = any($1) and a.event_type in ('access.decision', 'device.posture.evaluated', 'session.revoked')
        order by a.id`,
      [[employee.username, admin.username]],
    );
    console.log("\nAccess audit trail:");
    for (const r of audit.rows) console.log(`  ${r.event_type} ${r.resource ?? ""} -> ${r.outcome}${r.reason ? ` (${r.reason})` : ""}`);
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
