import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/config/env";
import { recordAuditEvent } from "@/server/audit/log";
import { safeReturnTo } from "@/server/auth/login";
import { query } from "@/server/db/client";
import { evaluatePosture } from "@/server/device-posture/evaluate";
import { DEVICE_COOKIE, findDevice, type Device } from "@/server/device-posture/store";
import type { PostureAssessment } from "@/server/device-posture/types";
import { decide } from "@/server/policy-engine/decide";
import type { PolicyDecision } from "@/server/policy-engine/types";
import { requestContext } from "@/server/request-context";
import { assessRisk } from "@/server/risk-engine/assess";
import { inTrustedNetworks, isOffHours, parseDays } from "@/server/risk-engine/context";
import type { RiskAssessment } from "@/server/risk-engine/types";
import { getCurrentSession } from "@/server/session/current";
import { endSession, recordAccess } from "@/server/session/store";
import type { AuthenticatedSession } from "@/server/session/types";

/**
 * Policy enforcement point.
 *
 * Every protected page calls `requireAccess(resource, path)`. On each request it:
 *   1. verifies the session (src/server/session/current.ts),
 *   2. checks the session is used from the device it was bound to (stolen-cookie defence),
 *   3. requires a fresh device posture report (re-collected by the browser if stale),
 *   4. scores risk from posture, device, network, time and recent failures,
 *   5. asks the policy engine for allow / step-up / deny,
 *   6. audits the decision (every non-allow, and any change of risk level).
 */

export interface AccessContext extends AuthenticatedSession {
  device: Device;
  posture: PostureAssessment;
  risk: RiskAssessment;
  decision: PolicyDecision;
  authAgeMinutes: number;
}

export type AccessEvaluation =
  | { kind: "redirect"; to: string }
  | { kind: "evaluated"; ctx: AccessContext };

const withReturnTo = (base: string, path: string) => `${base}?returnTo=${encodeURIComponent(path)}`;

async function recentFailedLogins(keycloakSub: string): Promise<number> {
  const { rows } = await query<{ n: number }>(
    `select count(*)::int as n from trustguard.audit_events
      where event_type = 'auth.login.failure'
        and metadata->>'sub' = $1
        and occurred_at > now() - interval '1 hour'`,
    [keycloakSub],
  );
  return rows[0].n;
}

export async function evaluateAccess(
  resource: string,
  path: string,
  { audit = true }: { audit?: boolean } = {},
): Promise<AccessEvaluation> {
  const current = await getCurrentSession();
  if (!current) return { kind: "redirect", to: withReturnTo("/login", path) };
  const { session, user } = current;
  const env = getEnv();
  const hdrs = await headers();
  const ctx = requestContext(hdrs);

  // 2. Device binding. No posture yet means the device has not been verified.
  if (!session.deviceId || !session.posture || !session.postureAt) {
    return { kind: "redirect", to: withReturnTo("/verify-device", path) };
  }
  const deviceCookie = (await cookies()).get(DEVICE_COOKIE)?.value;
  const device = deviceCookie ? await findDevice(user.id, deviceCookie) : null;
  if (!device || device.id !== session.deviceId) {
    if (await endSession(session.id, "revoked", "device_mismatch")) {
      await recordAuditEvent({
        type: "session.revoked",
        outcome: "deny",
        actorUserId: user.id,
        sessionId: session.id,
        ...ctx,
        resource,
        metadata: { reason: "device_mismatch" },
      });
    }
    return { kind: "redirect", to: "/login?error=device_mismatch" };
  }

  // 3. Posture freshness: the browser re-reports every few minutes.
  if (Date.now() - session.postureAt.getTime() > env.POSTURE_MAX_AGE_MINUTES * 60_000) {
    return { kind: "redirect", to: withReturnTo("/verify-device", path) };
  }
  const posture = evaluatePosture(session.posture, ctx.userAgent);

  // 4. Risk.
  const risk = assessRisk({
    posture,
    device: { isNew: device.firstSessionId === session.id, trusted: device.status === "trusted" },
    network: {
      ipChanged: !!session.ipAddress && !!ctx.ipAddress && session.ipAddress !== ctx.ipAddress,
      onTrustedNetwork: inTrustedNetworks(ctx.ipAddress, env.TRUSTED_NETWORKS),
    },
    time: {
      offHours: isOffHours(new Date(), {
        timeZone: env.BUSINESS_TIMEZONE,
        hours: env.BUSINESS_HOURS,
        days: parseDays(env.BUSINESS_DAYS),
      }),
    },
    recentFailedLogins: await recentFailedLogins(user.keycloakSub),
  });

  // 5. Policy decision. Sessions are only created after password + OTP, so the
  //    session's age is the time since the last strong authentication.
  const authAgeMinutes = (Date.now() - session.createdAt.getTime()) / 60_000;
  const decision = decide({
    resource,
    roles: user.roles,
    risk,
    authAgeMinutes,
    device: { trusted: device.status === "trusted", blocked: device.status === "blocked" },
  });

  // 6. Audit: every step-up/deny, and allows only when the outcome changes.
  const key = `${decision.decision}:${risk.level}`;
  if (audit && (decision.decision !== "allow" || session.lastAccess[resource] !== key)) {
    await recordAuditEvent({
      type: "access.decision",
      outcome: decision.decision,
      actorUserId: user.id,
      sessionId: session.id,
      ...ctx,
      resource,
      metadata: {
        policyId: decision.policyId,
        reason: decision.reason,
        riskScore: risk.score,
        riskLevel: risk.level,
        signals: risk.signals.map((s) => s.code),
        device: device.label,
        deviceStatus: device.status,
      },
    });
    await recordAccess(session.id, resource, key);
  }

  return {
    kind: "evaluated",
    ctx: { session, user, device, posture, risk, decision, authAgeMinutes },
  };
}

/**
 * Use in protected pages. Returns only when the policy engine allows access.
 * `fallbackPath` is used when the proxy did not forward the request path.
 */
export async function requireAccess(resource: string, fallbackPath: string): Promise<AccessContext> {
  const forwarded = (await headers()).get("x-tg-path");
  const path = forwarded ? safeReturnTo(forwarded) : fallbackPath;
  const result = await evaluateAccess(resource, path);
  if (result.kind === "redirect") redirect(result.to);

  const { decision } = result.ctx;
  if (decision.decision === "step_up") {
    redirect(`${withReturnTo("/login", path)}&reason=step_up`);
  }
  if (decision.decision === "deny") {
    redirect(`/access-denied?resource=${encodeURIComponent(resource)}&returnTo=${encodeURIComponent(path)}`);
  }
  return result.ctx;
}
