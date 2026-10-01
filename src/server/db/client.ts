import "server-only";
import { Pool, type QueryResultRow } from "pg";
import { getEnv } from "@/config/env";

/**
 * PostgreSQL access layer (Supabase PostgreSQL).
 *
 * Trust Guard talks to Supabase as a plain PostgreSQL database over a server-side
 * connection pool. The Supabase client SDK, Supabase Auth and the public Data API
 * are deliberately NOT used: identity belongs to Keycloak, and data is only
 * reachable through the BFF (Next.js server code).
 *
 * All application tables live in the `trustguard` schema (see db/migrations).
 */

export const APP_SCHEMA = "trustguard";

// Reuse one pool across hot reloads in development.
const globalForDb = globalThis as unknown as { __trustGuardPool?: Pool };

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. Copy .env.example to .env and configure it.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function isDatabaseConfigured(): boolean {
  return Boolean(getEnv().DATABASE_URL);
}

export function getPool(): Pool {
  const env = getEnv();
  if (!env.DATABASE_URL) throw new DatabaseNotConfiguredError();

  if (!globalForDb.__trustGuardPool) {
    globalForDb.__trustGuardPool = new Pool({
      connectionString: env.DATABASE_URL,
      // Traffic to Supabase is encrypted. Certificate pinning against the Supabase
      // CA (downloadable from the dashboard) is a hardening step for later.
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // An idle client losing its connection must not crash the server process.
    globalForDb.__trustGuardPool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  }
  return globalForDb.__trustGuardPool;
}

/**
 * Connection failures (e.g. ECONNREFUSED on a dual-stack host) surface as a Node
 * `AggregateError`. Normalise them to a plain Error with a readable message so
 * callers and loggers handle them uniformly.
 */
function normaliseDbError(err: unknown): Error {
  if (err instanceof AggregateError) {
    const code = (err as AggregateError & { code?: string }).code ?? "CONNECTION_ERROR";
    return new Error(`Database connection failed (${code})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Run a parameterised query. Always pass values via `params`, never string-concatenate. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
) {
  try {
    return await getPool().query<T>(text, params);
  } catch (err) {
    throw normaliseDbError(err);
  }
}
