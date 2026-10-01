/**
 * First-run setup: create `.env` from `.env.example` with fresh random secrets.
 *
 * Usage:  npm run setup
 *
 * Plain Node.js (no dependencies), so it works right after cloning. It never
 * overwrites an existing `.env` and never prints secrets.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.log(".env already exists; nothing changed. Delete it first to regenerate.");
  process.exit(0);
}

const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");
// Meets the realm password policy: 12+ chars with upper case, lower case and a digit.
const password = () => `Tg${randomBytes(12).toString("base64url").replace(/[-_]/g, "x")}7a`;

const appDbPassword = secret(24);
const generated = {
  APP_DB_PASSWORD: appDbPassword,
  // Local stand-in for Supabase (docker compose --profile local-db). Replace for Supabase cloud.
  DATABASE_URL: `postgresql://trustguard:${appDbPassword}@127.0.0.1:55432/trustguard`,
  KEYCLOAK_ADMIN_PASSWORD: password(),
  KEYCLOAK_DB_PASSWORD: secret(24),
  KEYCLOAK_CLIENT_SECRET: secret(),
  SESSION_SECRET: secret(),
  SEED_ADMIN_PASSWORD: password(),
  SEED_EMPLOYEE_PASSWORD: password(),
};

const filled = [];
const lines = readFileSync(".env.example", "utf8")
  .split(/\r?\n/)
  .map((line) => {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && m[2] === "" && generated[m[1]] !== undefined) {
      filled.push(m[1]);
      return `${m[1]}=${generated[m[1]]}`;
    }
    return line;
  });

writeFileSync(".env", lines.join("\n"));
console.log(`Created .env with generated values for: ${filled.join(", ")}`);
console.log(`
Next steps:
  npm run infra:up:local-db   # start Keycloak + databases (Keycloak needs ~1 minute)
  npm run db:migrate          # create the trustguard schema
  npm run dev                 # http://localhost:3000

Demo users: tg.admin and tg.employee. Their passwords are SEED_ADMIN_PASSWORD and
SEED_EMPLOYEE_PASSWORD in .env. Each enrols an authenticator app at first sign-in.`);
