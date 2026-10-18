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
  // Service account used by admin controls to end Keycloak sessions and suspend users.
  KEYCLOAK_ADMIN_CLIENT_ID: z.string().default("trust-guard-admin-api"),
  KEYCLOAK_ADMIN_CLIENT_SECRET: optionalString,

  SESSION_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
  // Session lifetime: sliding idle timeout and hard absolute limit.
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_ABSOLUTE_TIMEOUT_HOURS: z.coerce.number().int().positive().default(8),
  // Require the IdP to report a second factor (amr contains "otp"/"mfa") at login.
  AUTH_REQUIRE_MFA: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Device posture: how old a posture report may be before it is re-collected.
  POSTURE_MAX_AGE_MINUTES: z.coerce.number().int().positive().default(10),
  // Risk context: business hours (OFF_HOURS signal) and trusted networks (OFF_NETWORK signal).
  BUSINESS_TIMEZONE: z.string().default("Africa/Lagos"),
  BUSINESS_HOURS: z
    .string()
    .regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/, "expected HH:MM-HH:MM")
    .default("07:00-19:00"),
  BUSINESS_DAYS: z.string().default("1-5"),
  // Comma-separated CIDRs, e.g. "102.89.0.0/16,10.0.0.0/8". Empty: signal disabled.
  TRUSTED_NETWORKS: z
    .string()
    .default("")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
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
