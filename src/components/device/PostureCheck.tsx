"use client";

import { useEffect, useState } from "react";
import { sendPosture } from "./collect-posture";

/** Collects the device posture once, then continues to the requested page. */
export function PostureCheck({ returnTo }: { returnTo: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    sendPosture().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        window.location.replace(returnTo);
      } else if (result.httpStatus === 401) {
        window.location.replace(`/login?error=${result.error === "device_mismatch" ? "device_mismatch" : "session_ended"}`);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [returnTo]);

  if (failed) {
    return (
      <div role="alert" className="mt-6 text-sm text-red-700 dark:text-red-300">
        The device check could not be completed.{" "}
        <button type="button" className="underline" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  return <p className="mt-6 text-sm text-slate-500" aria-live="polite">Checking this device…</p>;
}
