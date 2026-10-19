import "server-only";
import { query } from "@/server/db/client";
import type { DevicePostureReport } from "@/server/device-posture/types";
import type { AuditFilters } from "./filters";

export type { AuditFilters } from "./filters";

/** Read models for the admin console. */

export async function adminStats() {
  const { rows } = await query<{
    active_sessions: number;
    users: number;
    suspended_users: number;
    devices: number;
    blocked_devices: number;
    denials_24h: number;
  }>(
    `select
       (select count(*)::int from trustguard.sessions
         where status = 'active' and absolute_expires_at > now()) as active_sessions,
       (select count(*)::int from trustguard.users) as users,
       (select count(*)::int from trustguard.users where suspended_at is not null) as suspended_users,
       (select count(*)::int from trustguard.devices) as devices,
       (select count(*)::int from trustguard.devices where status = 'blocked') as blocked_devices,
       (select count(*)::int from trustguard.audit_events
         where outcome in ('deny', 'failure') and occurred_at > now() - interval '24 hours') as denials_24h`,
  );
  return rows[0];
}

export interface SessionListItem {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  device_id: string | null;
  device_label: string | null;
  device_status: string | null;
  ip_address: string | null;
  created_at: Date;
  last_seen_at: Date;
  posture_at: Date | null;
  auth_methods: string[];
  last_access: Record<string, string>;
}

/** Active sessions (not past their absolute lifetime), most recent activity first. */
export async function listActiveSessions(): Promise<SessionListItem[]> {
  const { rows } = await query<SessionListItem>(
    `select s.id, s.user_id, u.username, u.display_name, s.device_id, d.label as device_label,
            d.status as device_status, host(s.ip_address) as ip_address, s.created_at, s.last_seen_at,
            s.posture_at, s.auth_methods, s.last_access
       from trustguard.sessions s
       join trustguard.users u on u.id = s.user_id
       left join trustguard.devices d on d.id = s.device_id
      where s.status = 'active' and s.absolute_expires_at > now()
      order by s.last_seen_at desc
      limit 200`,
  );
  return rows;
}

export interface DeviceListItem {
  id: string;
  username: string;
  label: string | null;
  status: "registered" | "trusted" | "blocked";
  first_seen_at: Date;
  last_seen_at: Date;
  last_ip: string | null;
  last_posture: DevicePostureReport | null;
  active_sessions: number;
  status_changed_at: Date | null;
  status_changed_by: string | null;
}

export async function listDevices(): Promise<DeviceListItem[]> {
  const { rows } = await query<DeviceListItem>(
    `select d.id, u.username, d.label, d.status, d.first_seen_at, d.last_seen_at, host(d.last_ip) as last_ip,
            d.last_posture,
            (select count(*)::int from trustguard.sessions s
              where s.device_id = d.id and s.status = 'active' and s.absolute_expires_at > now()) as active_sessions,
            d.status_changed_at, a.username as status_changed_by
       from trustguard.devices d
       join trustguard.users u on u.id = d.user_id
       left join trustguard.users a on a.id = d.status_changed_by
      order by d.last_seen_at desc
      limit 500`,
  );
  return rows;
}

export interface UserListItem {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  roles: string[];
  last_login_at: Date | null;
  suspended_at: Date | null;
  suspended_by: string | null;
  active_sessions: number;
  devices: number;
}

export async function listUsers(): Promise<UserListItem[]> {
  const { rows } = await query<UserListItem>(
    `select u.id, u.username, u.display_name, u.email, u.roles, u.last_login_at, u.suspended_at,
            a.username as suspended_by,
            (select count(*)::int from trustguard.sessions s
              where s.user_id = u.id and s.status = 'active' and s.absolute_expires_at > now()) as active_sessions,
            (select count(*)::int from trustguard.devices d where d.user_id = u.id) as devices
       from trustguard.users u
       left join trustguard.users a on a.id = u.suspended_by
      order by u.last_login_at desc nulls last
      limit 500`,
  );
  return rows;
}

export interface AuditRow {
  id: string;
  occurred_at: Date;
  event_type: string;
  outcome: string;
  username: string | null;
  resource: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

/** Filtered audit events, newest first. `from`/`to` are whole UTC days, inclusive. */
export async function queryAudit(f: AuditFilters, limit = 200): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.type) add("a.event_type = ?", f.type);
  if (f.outcome) add("a.outcome = ?", f.outcome);
  if (f.user) add("u.username ilike ?", `%${f.user.replace(/[%_\\]/g, "\\$&")}%`);
  if (f.from) add("a.occurred_at >= ?::date", f.from);
  if (f.to) add("a.occurred_at < (?::date + 1)", f.to);
  params.push(limit);

  const { rows } = await query<AuditRow>(
    `select a.id, a.occurred_at, a.event_type, a.outcome, u.username, a.resource,
            host(a.ip_address) as ip_address, a.user_agent, a.metadata
       from trustguard.audit_events a
       left join trustguard.users u on u.id = a.actor_user_id
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by a.id desc
      limit $${params.length}`,
    params,
  );
  return rows;
}

export async function auditEventTypes(): Promise<string[]> {
  const { rows } = await query<{ event_type: string }>(
    `select distinct event_type from trustguard.audit_events order by event_type`,
  );
  return rows.map((r) => r.event_type);
}

/** Security events per day for the last `days` days (oldest first, zero-filled), in UTC. */
export async function eventsPerDay(days = 7): Promise<{ day: string; events: number }[]> {
  const { rows } = await query<{ day: string; events: number }>(
    `select to_char(d, 'YYYY-MM-DD') as day,
            (select count(*)::int from trustguard.audit_events a
              where a.occurred_at >= d and a.occurred_at < d + interval '1 day') as events
       from generate_series(current_date - ($1::int - 1), current_date, interval '1 day') as d
      order by d`,
    [days],
  );
  return rows;
}

/** Event outcomes over the last `days` days, grouped as allowed / step-up / denied. */
export async function outcomeTotals(days = 7): Promise<{ allowed: number; stepUp: number; denied: number }> {
  const { rows } = await query<{ allowed: number; step_up: number; denied: number }>(
    `select count(*) filter (where outcome in ('success', 'allow'))::int as allowed,
            count(*) filter (where outcome = 'step_up')::int as step_up,
            count(*) filter (where outcome in ('failure', 'deny'))::int as denied
       from trustguard.audit_events
      where occurred_at > now() - make_interval(days => $1)`,
    [days],
  );
  return { allowed: rows[0].allowed, stepUp: rows[0].step_up, denied: rows[0].denied };
}
