/**
 * Administrative controls contracts.
 *
 * Admin capabilities require the Keycloak `tg-admin` realm role and pass the
 * `admin.manage` policy (low risk, or medium with a very recent sign-in).
 * Every admin action is audit-logged as `admin.action`.
 */

export const ADMIN_ROLE = "tg-admin";

export type AdminAction =
  | { kind: "revoke_session"; sessionId: string }
  | { kind: "sign_out_user"; userId: string }
  | { kind: "suspend_user"; userId: string }
  | { kind: "reactivate_user"; userId: string }
  | { kind: "trust_device"; deviceId: string }
  | { kind: "block_device"; deviceId: string }
  | { kind: "reset_device"; deviceId: string };

export type AdminActionKind = AdminAction["kind"];

/** Result codes shown to the admin (mapped to text in the UI; never free text from the URL). */
export type AdminNotice =
  | "session_revoked"
  | "user_signed_out"
  | "user_suspended"
  | "user_reactivated"
  | "device_trusted"
  | "device_blocked"
  | "device_reset";

export type AdminError =
  | "invalid_request"
  | "not_found"
  | "already_ended"
  | "self_session"
  | "self_suspend"
  | "self_device"
  | "idp_failed";

export type AdminActionResult =
  | { ok: true; notice: AdminNotice; idpSynced: boolean }
  | { ok: false; error: AdminError };

/** Parse an untrusted form submission into an action, or null. */
export function parseAdminAction(action: unknown, target: unknown): AdminAction | null {
  if (typeof action !== "string" || typeof target !== "string") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) return null;
  switch (action) {
    case "revoke_session":
      return { kind: action, sessionId: target };
    case "sign_out_user":
    case "suspend_user":
    case "reactivate_user":
      return { kind: action, userId: target };
    case "trust_device":
    case "block_device":
    case "reset_device":
      return { kind: action, deviceId: target };
    default:
      return null;
  }
}
