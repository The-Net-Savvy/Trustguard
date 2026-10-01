/**
 * Administrative controls: contracts only (implemented in a later phase).
 *
 * Admin capabilities are only available to users holding the Keycloak
 * `tg-admin` realm role, and every admin action is audit-logged.
 */

export const ADMIN_ROLE = "tg-admin";

export type AdminAction =
  | { kind: "revoke_session"; sessionId: string }
  | { kind: "block_device"; deviceId: string }
  | { kind: "trust_device"; deviceId: string }
  | { kind: "update_policy"; policyId: string };
