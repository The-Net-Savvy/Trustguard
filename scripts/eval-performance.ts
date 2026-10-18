/**
 * Performance evaluation: what do the Zero Trust checks cost?
 *
 * Run against a PRODUCTION build (`npm run build && npm start`), stack running.
 *
 *  1. Decision logic alone: posture evaluation + risk scoring + policy decision (pure, in-process).
 *  2. HTTP latency, N sequential requests each, after warm-up:
 *       baseline   GET /login without a session (page render, no verification work)
 *       dashboard  GET /dashboard (full chain: session, device binding, posture, risk, policy)
 *       admin      GET /admin (chain twice: view + manage, plus admin queries)
 *       heartbeat  POST /api/device/posture
 *       refresh    GET /dashboard with an expired access token (adds a Keycloak token refresh)
 *  3. Database transactions per request (pg_stat_database delta / N; autocommit = one per query).
 *  4. Complete sign-in (password + OTP + device verification), scripted, a few samples.
 *
 * Writes docs/evaluation/results/performance.{json,md}.
 * Usage:  npm run eval:performance
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { Client } from "pg";
import { evaluatePosture } from "@/server/device-posture/evaluate";
import { decide } from "@/server/policy-engine/decide";
import { assessRisk } from "@/server/risk-engine/assess";
import { APP, Browser, createTestUser, login, nextTotpWindow, posture, type TestUser } from "./lib/e2e";

const N = Number(process.env.EVAL_N ?? 200);
const WARMUP = 20;

interface Stats {
  name: string;
  description: string;
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  dbTxPerRequest?: number;
}

function stats(name: string, description: string, samples: number[], dbTxPerRequest?: number): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    name,
    description,
    n: s.length,
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
    p50: r(q(50)),
    p95: r(q(95)),
    p99: r(q(99)),
    max: r(s[s.length - 1]),
    dbTxPerRequest,
  };
}

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const dbTx = async () =>
    Number((await db.query(`select xact_commit + xact_rollback as n from pg_stat_database where datname = current_database()`)).rows[0].n);

  const health = await fetch(`${APP}/api/health`);
  if (!health.ok) throw new Error(`stack not healthy: HTTP ${health.status}`);

  const results: Stats[] = [];
  const users: TestUser[] = [];

  try {
    // ---- 1. Decision logic alone ------------------------------------------------------
    const b0 = new Browser();
    const report = { ...posture(b0, { platformVersion: "10.0.0" }), collectedAt: new Date().toISOString() };
    const ITER = 100_000;
    const t0 = performance.now();
    for (let i = 0; i < ITER; i++) {
      const p = evaluatePosture(report, b0.userAgent);
      const risk = assessRisk({
        posture: p,
        device: { isNew: i % 2 === 0, trusted: false },
        network: { ipChanged: false, onTrustedNetwork: null },
        time: { offHours: false },
        recentFailedLogins: 0,
      });
      decide({ resource: "admin.console", roles: ["tg-admin"], risk, authAgeMinutes: 5, device: { trusted: false, blocked: false } });
    }
    const perDecisionUs = ((performance.now() - t0) * 1000) / ITER;
    console.log(`Decision logic: ${perDecisionUs.toFixed(2)} µs per evaluation (${ITER} iterations)`);

    // ---- Sessions for the HTTP measurements ----------------------------------------------
    const admin = await createTestUser(["tg-admin"], "perf");
    users.push(admin);
    const ab = new Browser();
    const enrol = await login(ab, admin.username, admin.password, { enrol: true });
    await nextTotpWindow();
    await login(ab, admin.username, admin.password, { secret: enrol.totpSecret! }, { reauth: true, returnTo: "/admin" });
    const sessionId = (
      await db.query(
        `select s.id from trustguard.sessions s join trustguard.users u on u.id = s.user_id
          where u.username = $1 order by s.created_at desc limit 1`,
        [admin.username],
      )
    ).rows[0].id;

    const time = async (fn: () => Promise<Response>, expectStatus: number) => {
      const start = performance.now();
      const res = await fn();
      await res.arrayBuffer();
      const ms = performance.now() - start;
      if (res.status !== expectStatus) throw new Error(`unexpected HTTP ${res.status} (expected ${expectStatus})`);
      return ms;
    };

    const measure = async (
      name: string,
      description: string,
      fn: () => Promise<Response>,
      expectStatus: number,
      n = N,
      before?: () => Promise<void>,
    ) => {
      for (let i = 0; i < Math.min(WARMUP, n); i++) {
        if (before) await before();
        await time(fn, expectStatus);
      }
      const samples: number[] = [];
      const tx0 = await dbTx();
      for (let i = 0; i < n; i++) {
        if (before) await before();
        samples.push(await time(fn, expectStatus));
      }
      // Subtract this script's own transactions (dbTx reads + `before` updates).
      const own = 2 + (before ? n : 0);
      const tx = ((await dbTx()) - tx0 - own) / n;
      const s = stats(name, description, samples, Math.round(tx * 10) / 10);
      results.push(s);
      console.log(`${name.padEnd(10)} p50 ${s.p50} ms  p95 ${s.p95} ms  (${s.dbTxPerRequest} DB tx/request)`);
    };

    // ---- 2 + 3. HTTP latency and DB load ------------------------------------------------
    const anon = new Browser();
    await measure("baseline", "GET /login without a session: page render, no verification", () => anon.request(`${APP}/login`), 200);
    await measure("dashboard", "GET /dashboard: session + device binding + posture + risk + policy", () => ab.request(`${APP}/dashboard`), 200);
    await measure("admin", "GET /admin: two policy evaluations (view + manage) + admin queries", () => ab.request(`${APP}/admin`), 200);
    const report2 = JSON.stringify(posture(ab));
    await measure(
      "heartbeat",
      "POST /api/device/posture: device check + posture store",
      () =>
        ab.request(`${APP}/api/device/posture`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: APP },
          body: report2,
        }),
      200,
    );
    await measure(
      "refresh",
      "GET /dashboard with an expired access token: adds a Keycloak refresh-token round trip",
      () => ab.request(`${APP}/dashboard`),
      200,
      Math.min(N, 50),
      async () => {
        await db.query(`update trustguard.sessions set access_expires_at = now() - interval '1 minute' where id = $1`, [sessionId]);
      },
    );

    // ---- 4. Complete sign-in --------------------------------------------------------------
    const signIns: number[] = [];
    for (let i = 0; i < 3; i++) {
      await nextTotpWindow();
      const b = new Browser();
      const start = performance.now();
      const r = await login(b, admin.username, admin.password, { secret: enrol.totpSecret! }, { returnTo: "/dashboard" });
      if (r.finalUrl.pathname !== "/dashboard") throw new Error(`sign-in ended at ${r.finalUrl.pathname}`);
      signIns.push(performance.now() - start);
    }
    const signIn = stats(
      "sign-in",
      "Scripted sign-in: app -> Keycloak password + OTP -> callback -> device verification -> dashboard (no human time)",
      signIns,
    );
    results.push(signIn);
    console.log(`sign-in    mean ${signIn.mean} ms over ${signIn.n} runs`);

    // ---- Report -------------------------------------------------------------------------------
    const get = (n: string) => results.find((r) => r.name === n)!;
    const overhead = {
      dashboardVsBaselineP50: Math.round((get("dashboard").p50 - get("baseline").p50) * 100) / 100,
      dashboardVsBaselineP95: Math.round((get("dashboard").p95 - get("baseline").p95) * 100) / 100,
      refreshVsDashboardP50: Math.round((get("refresh").p50 - get("dashboard").p50) * 100) / 100,
    };
    const env = {
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      cpu: os.cpus()[0]?.model.trim(),
      cores: os.cpus().length,
      memoryGb: Math.round(os.totalmem() / 1024 ** 3),
      server: "next start (production build), PostgreSQL 17 + Keycloak 26.4 in Docker Desktop (WSL2), all on one machine",
      requestsPerScenario: N,
      warmup: WARMUP,
    };
    const generatedAt = new Date().toISOString();
    mkdirSync("docs/evaluation/results", { recursive: true });
    writeFileSync(
      "docs/evaluation/results/performance.json",
      JSON.stringify({ generatedAt, env, decisionLogicMicroseconds: Math.round(perDecisionUs * 100) / 100, overhead, results }, null, 2) + "\n",
    );
    const md = [
      `# Performance evaluation results`,
      ``,
      `Generated by \`npm run eval:performance\` on ${generatedAt}.`,
      ``,
      `**Environment:** ${env.cpu} (${env.cores} logical cores), ${env.memoryGb} GB RAM, ${env.os}, Node.js ${env.node}. ${env.server}.`,
      `Requests are sequential from one client over localhost; ${WARMUP} warm-up requests per scenario are excluded.`,
      ``,
      `| Scenario | What it measures | n | Mean (ms) | p50 (ms) | p95 (ms) | p99 (ms) | DB transactions / request |`,
      `|---|---|---|---|---|---|---|---|`,
      ...results.map(
        (r) => `| ${r.name} | ${r.description} | ${r.n} | ${r.mean} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.dbTxPerRequest ?? "—"} |`,
      ),
      ``,
      `- **Decision logic alone** (posture evaluation + risk scoring + policy decision): **${perDecisionUs.toFixed(2)} µs** per evaluation.`,
      `- **Zero Trust overhead per protected request** (dashboard − baseline): **${overhead.dashboardVsBaselineP50} ms at p50**, ${overhead.dashboardVsBaselineP95} ms at p95.`,
      `- **Token refresh** (every 5 minutes per session, re-verifies the session with Keycloak): +${overhead.refreshVsDashboardP50} ms at p50 on the request that triggers it.`,
      ``,
    ].join("\n");
    writeFileSync("docs/evaluation/results/performance.md", md);
    console.log(`\nOverhead dashboard vs baseline: p50 +${overhead.dashboardVsBaselineP50} ms. Written to docs/evaluation/results/performance.{json,md}`);
  } finally {
    for (const u of users) await u.remove().catch(() => {});
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
