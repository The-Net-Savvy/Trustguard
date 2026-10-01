import "server-only";
import * as oidc from "openid-client";
import { getEnv } from "@/config/env";

/**
 * Keycloak (OIDC identity provider) boundary.
 *
 * Every Keycloak-specific detail lives in this module. The BFF uses the
 * Authorization Code flow with PKCE (S256) as a confidential client; MFA
 * (TOTP) is enforced by the realm's browser authentication flow, and the app
 * additionally checks the `amr` claim (see `src/server/auth/login.ts`).
 */

export interface KeycloakConfig {
  /** Realm issuer, e.g. http://localhost:8080/realms/trust-guard */
  issuer: string;
  clientId: string;
  clientSecret: string;
  endpoints: {
    discovery: string;
    authorization: string;
    token: string;
    userinfo: string;
    endSession: string;
    jwks: string;
  };
}

export function isKeycloakConfigured(): boolean {
  return getKeycloakConfig() !== null;
}

/** Returns the Keycloak config, or `null` while the IdP has not been configured yet. */
export function getKeycloakConfig(): KeycloakConfig | null {
  const env = getEnv();
  if (!env.KEYCLOAK_ISSUER || !env.KEYCLOAK_CLIENT_ID || !env.KEYCLOAK_CLIENT_SECRET) {
    return null;
  }

  const issuer = env.KEYCLOAK_ISSUER.replace(/\/+$/, "");
  const base = `${issuer}/protocol/openid-connect`;

  return {
    issuer,
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
    endpoints: {
      discovery: `${issuer}/.well-known/openid-configuration`,
      authorization: `${base}/auth`,
      token: `${base}/token`,
      userinfo: `${base}/userinfo`,
      endSession: `${base}/logout`,
      jwks: `${base}/certs`,
    },
  };
}

export class KeycloakNotConfiguredError extends Error {
  constructor() {
    super("Keycloak is not configured (set KEYCLOAK_* in .env).");
    this.name = "KeycloakNotConfiguredError";
  }
}

/** OIDC scopes requested at login. */
export const OIDC_SCOPES = "openid profile email";

/** Where Keycloak sends the browser back after login / logout. */
export function redirectUris() {
  const appUrl = getEnv().APP_URL.replace(/\/+$/, "");
  return {
    callback: `${appUrl}/api/auth/callback`,
    postLogout: `${appUrl}/login?signed_out=1`,
  };
}

// Discovery is cached per module instance, not on globalThis: Next.js bundles route
// handlers and server components separately, each with its own copy of openid-client,
// and a Configuration from one copy fails the other's `instanceof` check.
let discovered: Promise<oidc.Configuration> | undefined;

/** The discovered OIDC client configuration for the Keycloak realm. */
export function getOidcConfiguration(): Promise<oidc.Configuration> {
  const kc = getKeycloakConfig();
  if (!kc) return Promise.reject(new KeycloakNotConfiguredError());

  if (!discovered) {
    const issuerUrl = new URL(kc.issuer);
    discovered = oidc
      .discovery(
        issuerUrl,
        kc.clientId,
        { client_secret: kc.clientSecret, id_token_signed_response_alg: "RS256" },
        oidc.ClientSecretBasic(kc.clientSecret),
        // Local Keycloak runs on plain HTTP; production must use HTTPS.
        issuerUrl.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined,
      )
      .catch((err) => {
        // Do not cache failures: retry discovery on the next request.
        discovered = undefined;
        throw err;
      });
  }
  return discovered;
}
