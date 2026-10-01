import "server-only";
import * as oidc from "openid-client";
import { getEnv } from "@/config/env";
import type { RequestContext } from "@/server/request-context";
import { decrypt, encrypt } from "@/server/session/crypto";
import { createSession, upsertUser } from "@/server/session/store";
import type { SessionUser, StoredTokens } from "@/server/session/types";
import { getOidcConfiguration, OIDC_SCOPES, redirectUris } from "./keycloak";

/**
 * OIDC Authorization Code + PKCE login, run entirely on the server.
 *
 * 1. `startLogin` creates state, nonce and a PKCE verifier, stores them in a short-lived
 *    encrypted cookie (the "login transaction") and returns the Keycloak authorization URL.
 * 2. Keycloak authenticates the user (password + TOTP) and redirects to /api/auth/callback.
 * 3. `completeLogin` validates state/nonce/PKCE and the ID token, checks MFA, provisions
 *    the user and creates a server-side session.
 */

export const LOGIN_TX_COOKIE = "tg_login_tx";
const LOGIN_TX_TTL_SECONDS = 600;

interface LoginTransaction {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  createdAt: number;
}

export type LoginErrorCode =
  | "transaction_missing"
  | "transaction_invalid"
  | "idp_error"
  | "access_denied"
  | "token_exchange_failed"
  | "mfa_required"
  | "invalid_claims";

export class LoginError extends Error {
  constructor(
    readonly code: LoginErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LoginError";
  }
}

/** Only allow same-origin relative paths as post-login destinations (no open redirects). */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return "/dashboard";
  }
  return value;
}

export function loginTransactionCookieOptions() {
  return {
    httpOnly: true,
    // Lax: the cookie must accompany the top-level redirect back from Keycloak.
    sameSite: "lax" as const,
    secure: getEnv().APP_URL.startsWith("https://"),
    path: "/api/auth",
    maxAge: LOGIN_TX_TTL_SECONDS,
  };
}

/**
 * `forceReauth` sends `prompt=login`, so Keycloak ignores its SSO cookie and runs the
 * full password + one-time-code flow again. Used right after a user enrols their
 * authenticator: Keycloak verifies the enrolment code in a required action, not in
 * the OTP login step, so that first login carries `amr=["pwd"]` only.
 */
export async function startLogin(
  returnTo: string,
  { forceReauth = false }: { forceReauth?: boolean } = {},
): Promise<{ authorizationUrl: URL; transactionCookie: string }> {
  const config = await getOidcConfiguration();
  const tx: LoginTransaction = {
    state: oidc.randomState(),
    nonce: oidc.randomNonce(),
    codeVerifier: oidc.randomPKCECodeVerifier(),
    returnTo: safeReturnTo(returnTo),
    createdAt: Date.now(),
  };

  const authorizationUrl = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUris().callback,
    scope: OIDC_SCOPES,
    state: tx.state,
    nonce: tx.nonce,
    code_challenge: await oidc.calculatePKCECodeChallenge(tx.codeVerifier),
    code_challenge_method: "S256",
    ...(forceReauth ? { prompt: "login" } : {}),
  });

  return {
    authorizationUrl,
    transactionCookie: encrypt(JSON.stringify(tx), "login-transaction"),
  };
}

function readTransaction(cookieValue: string | undefined): LoginTransaction {
  if (!cookieValue) {
    throw new LoginError("transaction_missing", "Login transaction cookie missing or expired");
  }
  const json = decrypt(cookieValue, "login-transaction");
  if (!json) throw new LoginError("transaction_invalid", "Login transaction cookie is invalid");
  const tx = JSON.parse(json) as LoginTransaction;
  if (Date.now() - tx.createdAt > LOGIN_TX_TTL_SECONDS * 1000) {
    throw new LoginError("transaction_invalid", "Login transaction expired");
  }
  return tx;
}

/** Second-factor methods Keycloak can report in the `amr` claim. */
const MFA_METHODS = new Set(["otp", "mfa", "hwk", "swk"]);

export function hasSecondFactor(amr: string[]): boolean {
  return amr.some((m) => MFA_METHODS.has(m));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** App roles come from the `roles` claim (Keycloak realm roles mapper on the client). */
export function rolesFromClaims(claims: Record<string, unknown> | undefined): string[] {
  return stringArray(claims?.roles).filter((r) => r.startsWith("tg-")).sort();
}

export interface CompletedLogin {
  cookieValue: string;
  sessionId: string;
  user: SessionUser;
  returnTo: string;
  authMethods: string[];
}

export async function completeLogin(
  callbackUrl: URL,
  transactionCookie: string | undefined,
  context: RequestContext,
): Promise<CompletedLogin> {
  const tx = readTransaction(transactionCookie);

  // Errors reported by Keycloak itself (e.g. user cancelled, account disabled).
  const idpError = callbackUrl.searchParams.get("error");
  if (idpError) {
    throw new LoginError(
      idpError === "access_denied" ? "access_denied" : "idp_error",
      `Identity provider returned "${idpError}"`,
      { error: idpError, description: callbackUrl.searchParams.get("error_description") },
    );
  }

  const config = await getOidcConfiguration();
  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
  try {
    tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: tx.codeVerifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
      idTokenExpected: true,
    });
  } catch (err) {
    throw new LoginError("token_exchange_failed", "Authorization code exchange failed", {
      cause: (err as Error).message,
    });
  }

  const claims = tokens.claims();
  if (!claims?.sub) throw new LoginError("invalid_claims", "ID token has no subject");

  const authMethods = stringArray(claims.amr);
  if (getEnv().AUTH_REQUIRE_MFA && !hasSecondFactor(authMethods)) {
    throw new LoginError("mfa_required", "Login did not include a second factor", {
      sub: claims.sub,
      amr: authMethods,
    });
  }

  const user = await upsertUser({
    sub: claims.sub,
    username: typeof claims.preferred_username === "string" ? claims.preferred_username : claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    displayName: typeof claims.name === "string" ? claims.name : null,
    roles: rolesFromClaims(claims),
  });

  const storedTokens: StoredTokens = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
  };
  const { cookieValue, sessionId } = await createSession({
    userId: user.id,
    tokens: storedTokens,
    accessExpiresAt: new Date(Date.now() + (tokens.expiresIn() ?? 60) * 1000),
    idpSessionId: typeof claims.sid === "string" ? claims.sid : null,
    authMethods,
    context,
  });

  return { cookieValue, sessionId, user, returnTo: tx.returnTo, authMethods };
}
