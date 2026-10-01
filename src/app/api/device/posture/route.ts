import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/config/env";
import { recordAuditEvent } from "@/server/audit/log";
import { evaluatePosture, parsePostureReport } from "@/server/device-posture/evaluate";
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  findDevice,
  newDeviceCookie,
  recordDevicePosture,
  registerDevice,
} from "@/server/device-posture/store";
import { requestContext } from "@/server/request-context";
import { getCurrentSession } from "@/server/session/current";
import { endSession, savePosture } from "@/server/session/store";

/**
 * POST /api/device/posture: the browser reports its device posture.
 *
 * Called right after sign-in (/verify-device) and then periodically by the
 * heartbeat. The first report binds the session to the device; later reports
 * from a different device revoke the session.
 */
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(getEnv().APP_URL).origin) {
    return NextResponse.json({ error: "cross-origin request rejected" }, { status: 403 });
  }
  const report = parsePostureReport(await request.json().catch(() => null));
  if (!report) return NextResponse.json({ error: "invalid posture report" }, { status: 400 });

  const current = await getCurrentSession();
  if (!current) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { session, user } = current;
  const ctx = requestContext(request.headers);

  let cookieValue = request.cookies.get(DEVICE_COOKIE)?.value;
  const issueCookie = !cookieValue;
  cookieValue ??= newDeviceCookie();

  const rejectDeviceMismatch = async () => {
    if (await endSession(session.id, "revoked", "device_mismatch")) {
      await recordAuditEvent({
        type: "session.revoked",
        outcome: "deny",
        actorUserId: user.id,
        sessionId: session.id,
        ...ctx,
        metadata: { reason: "device_mismatch", via: "posture_report" },
      });
    }
    return NextResponse.json({ error: "device_mismatch" }, { status: 401 });
  };

  let deviceId: string;
  let created = false;
  if (session.deviceId) {
    const device = await findDevice(user.id, cookieValue);
    if (!device || device.id !== session.deviceId) return rejectDeviceMismatch();
    deviceId = device.id;
  } else {
    const registered = await registerDevice(user.id, cookieValue, session.id);
    deviceId = registered.device.id;
    created = registered.created;
  }

  // Binding is atomic: if another device won a concurrent first report, this one is rejected.
  if (!(await savePosture(session.id, deviceId, report))) return rejectDeviceMismatch();

  const assessment = evaluatePosture(report, ctx.userAgent);
  const previous = session.posture ? evaluatePosture(session.posture, ctx.userAgent) : null;
  await recordDevicePosture(deviceId, assessment.label, report, ctx.ipAddress);

  // Audit the first report of a session and any change in the posture result.
  if (!previous || previous.failedChecks.join() !== assessment.failedChecks.join()) {
    await recordAuditEvent({
      type: "device.posture.evaluated",
      outcome: assessment.status === "compliant" ? "success" : "failure",
      actorUserId: user.id,
      sessionId: session.id,
      ...ctx,
      metadata: {
        device: assessment.label,
        newDevice: created,
        failedChecks: assessment.failedChecks,
      },
    });
  }

  const response = NextResponse.json({
    status: assessment.status,
    failedChecks: assessment.failedChecks,
    device: assessment.label,
  });
  if (issueCookie) response.cookies.set(DEVICE_COOKIE, cookieValue, deviceCookieOptions());
  return response;
}
