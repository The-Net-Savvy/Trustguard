import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getEnv } from "@/config/env";
import { query } from "@/server/db/client";
import type { DevicePostureReport } from "./types";

/**
 * Device registry. A device is identified by a random cookie the app issues
 * (`tg_device`), stored hashed. It is a per-browser identifier, not a hardware
 * fingerprint, and is scoped per user.
 */

export const DEVICE_COOKIE = "tg_device";

export function deviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: 400 * 24 * 3600, // browsers cap cookie lifetime at 400 days
  };
}

export function newDeviceCookie(): string {
  return randomBytes(32).toString("base64url");
}

function hash(cookieValue: string): Buffer {
  return createHash("sha256").update(cookieValue).digest();
}

export type DeviceStatus = "registered" | "trusted" | "blocked";

export interface Device {
  id: string;
  userId: string;
  status: DeviceStatus;
  label: string | null;
  firstSessionId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

interface DeviceRow {
  id: string;
  user_id: string;
  status: DeviceStatus;
  label: string | null;
  first_session_id: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
}

const toDevice = (r: DeviceRow): Device => ({
  id: r.id,
  userId: r.user_id,
  status: r.status,
  label: r.label,
  firstSessionId: r.first_session_id,
  firstSeenAt: r.first_seen_at,
  lastSeenAt: r.last_seen_at,
});

const COLUMNS = "id, user_id, status, label, first_session_id, first_seen_at, last_seen_at";

export async function findDevice(userId: string, cookieValue: string): Promise<Device | null> {
  const { rows } = await query<DeviceRow>(
    `select ${COLUMNS} from trustguard.devices where user_id = $1 and cookie_hash = $2`,
    [userId, hash(cookieValue)],
  );
  return rows[0] ? toDevice(rows[0]) : null;
}

export async function findDeviceById(id: string): Promise<Device | null> {
  const { rows } = await query<DeviceRow>(`select ${COLUMNS} from trustguard.devices where id = $1`, [id]);
  return rows[0] ? toDevice(rows[0]) : null;
}

/** Find the user's device for this cookie, registering it on first sight. */
export async function registerDevice(
  userId: string,
  cookieValue: string,
  sessionId: string,
): Promise<{ device: Device; created: boolean }> {
  const { rows } = await query<DeviceRow & { created: boolean }>(
    `insert into trustguard.devices (user_id, cookie_hash, first_session_id)
     values ($1, $2, $3)
     on conflict (user_id, cookie_hash) do update set last_seen_at = now()
     returning ${COLUMNS}, (xmax = 0) as created`,
    [userId, hash(cookieValue), sessionId],
  );
  return { device: toDevice(rows[0]), created: rows[0].created };
}

export async function recordDevicePosture(
  deviceId: string,
  label: string,
  posture: DevicePostureReport,
  ip: string | null,
): Promise<void> {
  await query(
    `update trustguard.devices
        set label = $2, last_posture = $3, last_ip = $4::inet, last_seen_at = now()
      where id = $1`,
    [deviceId, label, JSON.stringify(posture), ip],
  );
}
