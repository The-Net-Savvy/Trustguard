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
      <div role="alert" className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-900 ring-1 ring-rose-200">
        The device check could not be completed.{" "}
        <button type="button" className="underline" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  return <div className="mt-6 flex items-center gap-3 rounded-2xl bg-panel px-4 py-3 text-sm" aria-live="polite">
      <span className="size-4 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
      Checking this device…
    </div>;
}
