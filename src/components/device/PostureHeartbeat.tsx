"use client";

import { useEffect } from "react";
import { sendPosture } from "./collect-posture";

const INTERVAL_MS = 4 * 60_000;

/**
 * Continuous verification: re-reports device posture every few minutes and when
 * the tab becomes visible again. If the server ends the session (revoked, device
 * mismatch), the user is sent to the sign-in page immediately.
 */
export function PostureHeartbeat() {
  useEffect(() => {
    const beat = async () => {
      const result = await sendPosture();
      if (!result.ok && result.httpStatus === 401) {
        window.location.replace(`/login?error=${result.error === "device_mismatch" ? "device_mismatch" : "session_ended"}`);
      }
    };
    const timer = window.setInterval(beat, INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
