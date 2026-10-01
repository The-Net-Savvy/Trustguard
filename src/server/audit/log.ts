import "server-only";
import { query } from "@/server/db/client";
import type { AuditEvent } from "./types";

/**
 * Append an event to the audit log.
 *
 * Audit writes must never break the user-facing flow, so failures are reported
 * to the server log instead of being thrown.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await query(
      `insert into trustguard.audit_events
         (event_type, outcome, actor_user_id, session_id, ip_address, user_agent, resource, metadata)
       values ($1, $2, $3, $4, $5::inet, $6, $7, $8)`,
      [
        event.type,
        event.outcome,
        event.actorUserId ?? null,
        event.sessionId ?? null,
        event.ipAddress ?? null,
        event.userAgent ?? null,
        event.resource ?? null,
        JSON.stringify(event.metadata ?? {}),
      ],
    );
  } catch (err) {
    console.error("[audit] failed to record event", event.type, (err as Error).message);
  }
}
