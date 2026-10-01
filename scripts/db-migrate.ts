/**
 * Minimal SQL migration runner.
 *
 * Applies every `db/migrations/NNNN_name.sql` file that has not been applied yet,
 * in filename order, each inside its own transaction. Applied migrations are
 * recorded in `trustguard.schema_migrations`.
 *
 * Usage:  npm run db:migrate
 */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env first.");
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  try {
    await client.query(`create schema if not exists trustguard`);
    await client.query(`
      create table if not exists trustguard.schema_migrations (
        name        text primary key,
        applied_at  timestamptz not null default now()
      )`);

    const applied = new Set(
      (await client.query<{ name: string }>(`select name from trustguard.schema_migrations`))
        .rows.map((r) => r.name),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    let count = 0;

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(`insert into trustguard.schema_migrations (name) values ($1)`, [file]);
        await client.query("commit");
        console.log("done");
        count++;
      } catch (err) {
        await client.query("rollback");
        console.log("FAILED");
        throw err;
      }
    }

    console.log(count === 0 ? "Database is up to date." : `Applied ${count} migration(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
