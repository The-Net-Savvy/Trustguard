import "server-only";
import { recordAuditEvent } from "@/server/audit/log";
import {
  endIdpSession,
  isKeycloakAdminConfigured,
  logoutIdpUser,
  setIdpUserEnabled,
} from "@/server/auth/keycloak-admin";
import { query } from "@/server/db/client";
import type { RequestContext } from "@/server/request-context";
import type { AuthenticatedSession } from "@/server/session/types";
import type { AdminAction, AdminActionResult, AdminError } from "./types";

/**
 * Administrative actions (policy enforcement happens before this is called, in
 * /api/admin/actions via the `admin.manage` policy).
 *
 * Safeguards:
 *   - an admin cannot revoke their own current session, suspend themselves or block
 *     the device they are using (use "Sign out" instead; avoids accidental lock-out),
 *   - suspension is applied in Keycloak first; if that fails nothing is changed,
 *     because an app-only suspension could be bypassed by signing in again,
 *   - ending sessions also ends the matching Keycloak SSO sessions, so a revoked
 *     user cannot sign straight back in without a password and one-time code.
 */

type Actor = AuthenticatedSession;

interface RevokedRow {
  id: string;
  idp_session_id: string | null;
}

/** Revoke matching active sessions. `where` uses $3, $4, ... for `params`. */
async function revokeSessions(where: string, params: unknown[], actorId: string, reason: string) {
  const { rows } = await query<RevokedRow>(
    `update trustguard.sessions
        set status = 'revoked', revoked_at = now(), revoked_by = $1, revoked_reason = $2
      where status = 'active' and ${where}
      returning id, idp_session_id`,
    [actorId, reason, ...params],
  );
  return rows;
}

/** End the Keycloak sessions behind revoked app sessions. Returns false if any call failed. */
async function endIdpSessions(rows: RevokedRow[]): Promise<boolean> {
  if (!isKeycloakAdminConfigured()) return false;
  let ok = true;
  for (const sid of new Set(rows.map((r) => r.idp_session_id).filter((s): s is string => !!s))) {
    try {
      await endIdpSession(sid);
    } catch (err) {
      console.error("[admin] could not end Keycloak session:", (err as Error).message);
      ok = false;
    }
  }
  return ok;
}

async function findUser(userId: string) {
  const { rows } = await query<{ id: string; keycloak_sub: string; username: string; suspended_at: Date | null }>(
    `select id, keycloak_sub, username, suspended_at from trustguard.users where id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

async function run(actor: Actor, action: AdminAction): Promise<{ result: AdminActionResult; details: Record<string, unknown> }> {
  const fail = (error: AdminError, details: Record<string, unknown> = {}) => ({
    result: { ok: false as const, error },
    details,
  });
  const actorId = actor.user.id;

  switch (action.kind) {
    case "revoke_session": {
      if (action.sessionId === actor.session.id) return fail("self_session");
      const rows = await revokeSessions("id = $3", [action.sessionId], actorId, "admin_revoked");
      if (rows.length === 0) return fail("already_ended");
      const idpSynced = await endIdpSessions(rows);
      return { result: { ok: true, notice: "session_revoked", idpSynced }, details: { sessionId: action.sessionId } };
    }

    case "sign_out_user": {
      const user = await findUser(action.userId);
      if (!user) return fail("not_found");
      // An admin signing themselves out everywhere keeps the current session.
      const rows = await revokeSessions("user_id = $3 and id <> $4", [user.id, actor.session.id], actorId, "admin_signed_out");
      let idpSynced = isKeycloakAdminConfigured();
      if (user.id === actorId) {
        idpSynced = await endIdpSessions(rows);
      } else if (idpSynced) {
        try {
          await logoutIdpUser(user.keycloak_sub);
        } catch (err) {
          console.error("[admin] Keycloak logout failed:", (err as Error).message);
          idpSynced = false;
        }
      }
      return {
        result: { ok: true, notice: "user_signed_out", idpSynced },
        details: { targetUser: user.username, sessionsRevoked: rows.length },
      };
    }

    case "suspend_user": {
      if (action.userId === actorId) return fail("self_suspend");
      const user = await findUser(action.userId);
      if (!user) return fail("not_found");
      try {
        await setIdpUserEnabled(user.keycloak_sub, false);
        await logoutIdpUser(user.keycloak_sub);
      } catch (err) {
        return fail("idp_failed", { targetUser: user.username, cause: (err as Error).message });
      }
      await query(
        `update trustguard.users set suspended_at = now(), suspended_by = $2 where id = $1`,
        [user.id, actorId],
      );
      const rows = await revokeSessions("user_id = $3", [user.id], actorId, "user_suspended");
      return {
        result: { ok: true, notice: "user_suspended", idpSynced: true },
        details: { targetUser: user.username, sessionsRevoked: rows.length },
      };
    }

    case "reactivate_user": {
      const user = await findUser(action.userId);
      if (!user) return fail("not_found");
      try {
        await setIdpUserEnabled(user.keycloak_sub, true);
      } catch (err) {
        return fail("idp_failed", { targetUser: user.username, cause: (err as Error).message });
      }
      await query(`update trustguard.users set suspended_at = null, suspended_by = null where id = $1`, [user.id]);
      return { result: { ok: true, notice: "user_reactivated", idpSynced: true }, details: { targetUser: user.username } };
    }

    case "trust_device":
    case "block_device":
    case "reset_device": {
      if (action.kind === "block_device" && action.deviceId === actor.session.deviceId) return fail("self_device");
      const status = { trust_device: "trusted", block_device: "blocked", reset_device: "registered" }[action.kind];
      const { rows } = await query<{ id: string; label: string | null; username: string }>(
        `update trustguard.devices d
            set status = $2, status_changed_at = now(), status_changed_by = $3
           from trustguard.users u
          where d.id = $1 and u.id = d.user_id
          returning d.id, d.label, u.username`,
        [action.deviceId, status, actorId],
      );
      if (rows.length === 0) return fail("not_found");
      let sessionsRevoked = 0;
      let idpSynced = true;
      if (action.kind === "block_device") {
        const revoked = await revokeSessions("device_id = $3", [action.deviceId], actorId, "device_blocked");
        sessionsRevoked = revoked.length;
        idpSynced = await endIdpSessions(revoked);
      }
      const notice = { trust_device: "device_trusted", block_device: "device_blocked", reset_device: "device_reset" } as const;
      return {
        result: { ok: true, notice: notice[action.kind], idpSynced },
        details: { device: rows[0].label, targetUser: rows[0].username, sessionsRevoked },
      };
    }
  }
}

export async function performAdminAction(
  actor: Actor,
  action: AdminAction,
  context: RequestContext,
): Promise<AdminActionResult> {
  const { result, details } = await run(actor, action);
  await recordAuditEvent({
    type: "admin.action",
    outcome: result.ok ? "success" : "failure",
    actorUserId: actor.user.id,
    sessionId: actor.session.id,
    ...context,
    resource: "admin.manage",
    metadata: {
      action: action.kind,
      target: Object.values(action)[1],
      ...details,
      ...(result.ok ? { idpSynced: result.idpSynced } : { error: result.error }),
    },
  });
  return result;
}
