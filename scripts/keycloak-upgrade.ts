/**
 * Bring an already-imported `trust-guard` realm up to date (idempotent).
 *
 * Keycloak only imports the realm file on first start, so realms created before
 * phase 4 lack the `trust-guard-admin-api` service account. This script:
 *   1. generates KEYCLOAK_ADMIN_CLIENT_SECRET in .env if it is missing,
 *   2. creates (or updates) the service-account client with that secret,
 *   3. grants its service account the realm-management roles view-users and manage-users.
 *
 * Uses the Keycloak bootstrap admin from .env. Never prints secrets.
 * Usage:  npm run keycloak:upgrade
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

const CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || "trust-guard-admin-api";
const ROLES = ["view-users", "manage-users"];

async function main() {
  const issuer = process.env.KEYCLOAK_ISSUER;
  if (!issuer) throw new Error("KEYCLOAK_ISSUER is not set in .env");
  const origin = new URL(issuer).origin;
  const realm = issuer.split("/realms/")[1];

  let secret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
  if (!secret) {
    secret = randomBytes(32).toString("base64url");
    const env = readFileSync(".env", "utf8");
    appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}KEYCLOAK_ADMIN_CLIENT_SECRET=${secret}\n`);
    console.log("Generated KEYCLOAK_ADMIN_CLIENT_SECRET in .env");
  }

  const tokenRes = await fetch(`${origin}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: process.env.KEYCLOAK_ADMIN_USER || "admin",
      password: process.env.KEYCLOAK_ADMIN_PASSWORD || "",
    }),
  });
  if (!tokenRes.ok) throw new Error(`Keycloak admin login failed: HTTP ${tokenRes.status}`);
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const api = (path: string, init: RequestInit = {}) =>
    fetch(`${origin}/admin/realms/${realm}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json" },
    });

  const client = {
    clientId: CLIENT_ID,
    name: "Trust Guard (admin API)",
    description: "Service account used by Trust Guard admin controls to end Keycloak sessions and suspend users",
    enabled: true,
    protocol: "openid-connect",
    publicClient: false,
    clientAuthenticatorType: "client-secret",
    secret,
    standardFlowEnabled: false,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    frontchannelLogout: false,
    // The token can only carry roles the service account holds (view-users, manage-users).
    fullScopeAllowed: true,
  };

  let [existing] = (await (await api(`/clients?clientId=${CLIENT_ID}`)).json()) as { id: string }[];
  if (existing) {
    await api(`/clients/${existing.id}`, { method: "PUT", body: JSON.stringify({ ...client, id: existing.id }) });
    console.log(`Updated client ${CLIENT_ID}`);
  } else {
    const res = await api("/clients", { method: "POST", body: JSON.stringify(client) });
    if (res.status !== 201) throw new Error(`Creating client failed: HTTP ${res.status}`);
    [existing] = (await (await api(`/clients?clientId=${CLIENT_ID}`)).json()) as { id: string }[];
    console.log(`Created client ${CLIENT_ID}`);
  }

  const serviceUser = (await (await api(`/clients/${existing.id}/service-account-user`)).json()) as { id: string };
  const [realmMgmt] = (await (await api(`/clients?clientId=realm-management`)).json()) as { id: string }[];
  const available = (await (await api(`/clients/${realmMgmt.id}/roles`)).json()) as { name: string }[];
  const roles = available.filter((r) => ROLES.includes(r.name));
  await api(`/users/${serviceUser.id}/role-mappings/clients/${realmMgmt.id}`, {
    method: "POST",
    body: JSON.stringify(roles),
  });
  console.log(`Service account has realm-management roles: ${roles.map((r) => r.name).join(", ")}`);
  console.log("Done. Restart `npm run dev` so the app picks up the new .env value.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
