import "server-only";
import { getEnv } from "@/config/env";

/**
 * Keycloak (OIDC identity provider) configuration boundary.
 *
 * Every Keycloak-specific detail lives in this module, so the rest of the app only
 * depends on the `KeycloakConfig` shape. In the authentication phase the BFF will
 * use these values for the OIDC Authorization Code + PKCE flow; MFA (OTP/WebAuthn)
 * is enforced by Keycloak's authentication flows, not by app code.
 *
 * Nothing is implemented here yet beyond reading config and building endpoint URLs.
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
  const env = getEnv();
  return Boolean(env.KEYCLOAK_ISSUER && env.KEYCLOAK_CLIENT_ID && env.KEYCLOAK_CLIENT_SECRET);
}

/** Returns the Keycloak config, or `null` while the IdP has not been configured yet. */
export function getKeycloakConfig(): KeycloakConfig | null {
  const env = getEnv();
  if (!env.KEYCLOAK_ISSUER || !env.KEYCLOAK_CLIENT_ID || !env.KEYCLOAK_CLIENT_SECRET) {
    return null;
  }

  const issuer = env.KEYCLOAK_ISSUER.replace(/\/+$/, "");
  const oidc = `${issuer}/protocol/openid-connect`;

  return {
    issuer,
    clientId: env.KEYCLOAK_CLIENT_ID,
    clientSecret: env.KEYCLOAK_CLIENT_SECRET,
    endpoints: {
      discovery: `${issuer}/.well-known/openid-configuration`,
      authorization: `${oidc}/auth`,
      token: `${oidc}/token`,
      userinfo: `${oidc}/userinfo`,
      endSession: `${oidc}/logout`,
      jwks: `${oidc}/certs`,
    },
  };
}
