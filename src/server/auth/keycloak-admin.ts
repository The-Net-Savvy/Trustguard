import "server-only";
import { getEnv } from "@/config/env";
import { getKeycloakConfig } from "./keycloak";

/**
 * Keycloak Admin REST API client for administrative controls.
 *
 * Authenticates as the `trust-guard-admin-api` service account (client credentials),
 * which holds only the realm-management roles `view-users` and `manage-users` — not
 * the Keycloak master admin. Used so that an administrator's decision in Trust Guard
 * also ends the user's Keycloak SSO session: otherwise a revoked user could sign
 * straight back in through the SSO cookie without a password or one-time code.
 */

export class KeycloakAdminUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeycloakAdminUnavailableError";
  }
}

export function isKeycloakAdminConfigured(): boolean {
  return Boolean(getKeycloakConfig() && getEnv().KEYCLOAK_ADMIN_CLIENT_SECRET);
}

let cachedToken: { value: string; expiresAt: number } | undefined;

async function serviceToken(): Promise<string> {
  const kc = getKeycloakConfig();
  const env = getEnv();
  if (!kc || !env.KEYCLOAK_ADMIN_CLIENT_SECRET) {
    throw new KeycloakAdminUnavailableError("Keycloak admin API is not configured (KEYCLOAK_ADMIN_CLIENT_SECRET)");
  }
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) return cachedToken.value;

  const res = await fetch(kc.endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.KEYCLOAK_ADMIN_CLIENT_ID,
      client_secret: env.KEYCLOAK_ADMIN_CLIENT_SECRET,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new KeycloakAdminUnavailableError(`Service account token request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function adminRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const kc = getKeycloakConfig()!;
  // http://host/realms/<realm>  ->  http://host/admin/realms/<realm>
  const base = kc.issuer.replace("/realms/", "/admin/realms/");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${await serviceToken()}`);
  if (init.body) headers.set("content-type", "application/json");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  // 404: already gone (session ended, user deleted) — the desired end state.
  if (!res.ok && res.status !== 404) {
    throw new KeycloakAdminUnavailableError(`Keycloak admin API ${init.method ?? "GET"} ${path}: HTTP ${res.status}`);
  }
  return res;
}

/** End one Keycloak SSO session (the `sid` of an app session). */
export async function endIdpSession(idpSessionId: string): Promise<void> {
  await adminRequest(`/sessions/${encodeURIComponent(idpSessionId)}`, { method: "DELETE" });
}

/** End every Keycloak session of a user. */
export async function logoutIdpUser(keycloakSub: string): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(keycloakSub)}/logout`, { method: "POST" });
}

/** Enable or disable a Keycloak account. A disabled account cannot sign in. */
export async function setIdpUserEnabled(keycloakSub: string, enabled: boolean): Promise<void> {
  await adminRequest(`/users/${encodeURIComponent(keycloakSub)}`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}
