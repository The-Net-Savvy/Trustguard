import "server-only";
import { z } from "zod";

/**
 * Server-side environment configuration.
 *
 * All secrets are read from the environment (see `.env.example`) and validated
 * here once. Nothing in this file is exposed to the browser: `server-only`
 * makes the build fail if a client component imports it.
 */

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());

const envSchema = z.object({
  APP_NAME: z.string().default("Trust Guard"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  DATABASE_URL: optionalUrl,
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  KEYCLOAK_ISSUER: optionalUrl,
  KEYCLOAK_CLIENT_ID: optionalString,
  KEYCLOAK_CLIENT_SECRET: optionalString,

  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getEnv(): ServerEnv {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n");
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
