/**
 * Device posture validation: contracts only (implemented in a later phase).
 *
 * The browser collects a posture report; the BFF validates it and
 * produces an assessment that feeds the risk engine.
 */

export interface DevicePostureReport {
  /** Stable, app-generated device identifier (not a hardware ID). */
  deviceId: string;
  userAgent: string;
  platform: string;
  /** Whether the browser reports a secure context (HTTPS / localhost). */
  secureContext: boolean;
  screenLockLikely?: boolean;
  collectedAt: string;
}

export type PostureStatus = "compliant" | "non_compliant" | "unknown";

export interface PostureAssessment {
  deviceId: string;
  status: PostureStatus;
  /** True if this device was previously registered/trusted for the user. */
  knownDevice: boolean;
  failedChecks: string[];
}
