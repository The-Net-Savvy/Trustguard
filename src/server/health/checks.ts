import "server-only";
import { APP_SCHEMA, isDatabaseConfigured, query } from "@/server/db/client";
import { getKeycloakConfig } from "@/server/auth/keycloak";

/**
 * Infrastructure health checks used by `/api/health` and the status page.
 * Results never include secrets or connection strings.
 */

export type ComponentStatus = "ok" | "not_configured" | "error";

export interface ComponentHealth {
  status: ComponentStatus;
  detail: string;
  latencyMs?: number;
}

export interface SystemHealth {
  status: "ok" | "degraded";
  checkedAt: string;
  components: {
    app: ComponentHealth;
    database: ComponentHealth;
    identityProvider: ComponentHealth;
  };
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  return [result, Math.round(performance.now() - start)];
}

export async function checkDatabase(): Promise<ComponentHealth> {
  if (!isDatabaseConfigured()) {
    return { status: "not_configured", detail: "DATABASE_URL is not set" };
  }
  try {
    const [res, latencyMs] = await timed(() =>
      query<{ schema_exists: boolean; migrations: number | null }>(
        `select
           exists(select 1 from information_schema.schemata where schema_name = $1) as schema_exists,
           (select count(*)::int from information_schema.tables
              where table_schema = $1 and table_name = 'schema_migrations') as migrations`,
        [APP_SCHEMA],
      ),
    );
    const row = res.rows[0];
    if (!row.schema_exists) {
      return {
        status: "error",
        detail: `Connected, but schema "${APP_SCHEMA}" is missing. Run: npm run db:migrate`,
        latencyMs,
      };
    }
    const applied = row.migrations
      ? (await query<{ n: number }>(`select count(*)::int as n from ${APP_SCHEMA}.schema_migrations`))
          .rows[0].n
      : 0;
    return {
      status: "ok",
      detail: `Connected. Schema "${APP_SCHEMA}" present, ${applied} migration(s) applied`,
      latencyMs,
    };
  } catch (err) {
    return { status: "error", detail: `Connection failed: ${(err as Error).message}` };
  }
}

export async function checkIdentityProvider(): Promise<ComponentHealth> {
  const kc = getKeycloakConfig();
  if (!kc) {
    return {
      status: "not_configured",
      detail: "Keycloak OIDC client not configured yet (set KEYCLOAK_* in .env)",
    };
  }
  try {
    const [res, latencyMs] = await timed(() =>
      fetch(kc.endpoints.discovery, { cache: "no-store", signal: AbortSignal.timeout(5_000) }),
    );
    if (!res.ok) {
      return { status: "error", detail: `OIDC discovery returned HTTP ${res.status}`, latencyMs };
    }
    const doc = (await res.json()) as { issuer?: string };
    if (doc.issuer !== kc.issuer) {
      return { status: "error", detail: "Issuer mismatch in OIDC discovery document", latencyMs };
    }
    return { status: "ok", detail: `Realm reachable at ${kc.issuer}`, latencyMs };
  } catch (err) {
    return { status: "error", detail: `Keycloak unreachable: ${(err as Error).message}` };
  }
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [database, identityProvider] = await Promise.all([
    checkDatabase(),
    checkIdentityProvider(),
  ]);
  return {
    status: database.status === "error" || identityProvider.status === "error" ? "degraded" : "ok",
    checkedAt: new Date().toISOString(),
    components: {
      app: { status: "ok", detail: "Next.js server running" },
      database,
      identityProvider,
    },
  };
}
