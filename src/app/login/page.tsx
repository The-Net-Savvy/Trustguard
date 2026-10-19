import Link from "next/link";
import { Fingerprint, KeyRound, MonitorSmartphone } from "lucide-react";
import { AuthFrame, Notice, PRIMARY_BUTTON } from "@/components/shell/AuthFrame";
import { redirect } from "next/navigation";
import { isKeycloakConfigured } from "@/server/auth/keycloak";
import { safeReturnTo } from "@/server/auth/login";
import { getCurrentSession } from "@/server/session/current";

export const metadata = { title: "Sign in · Trust Guard" };

const ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled or denied by the identity provider.",
  idp_error: "The identity provider reported an error. Please try again.",
  idp_unavailable: "The identity provider is unreachable right now. Please try again shortly.",
  transaction_missing: "Your sign-in attempt expired. Please start again.",
  transaction_invalid: "Your sign-in attempt could not be verified. Please start again.",
  token_exchange_failed: "Sign-in could not be completed. Please start again.",
  mfa_required:
    "A one-time code is required. If you have just set up your authenticator app, sign in once more and enter a code from it to finish.",
  invalid_claims: "The identity provider returned an invalid identity.",
  device_mismatch:
    "Your session was ended because it was used from a different device or browser. Sign in again on this device.",
  session_ended: "Your session has ended. Please sign in again.",
  internal_error: "Something went wrong while signing you in.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const returnTo = safeReturnTo(one(params.returnTo));
  const error = one(params.error);
  const signedOut = one(params.signed_out) === "1";
  // The policy engine asks for step-up (re-authentication) on risky or sensitive access.
  const stepUp = one(params.reason) === "step_up";

  if (!stepUp && (await getCurrentSession())) redirect(returnTo);

  const configured = isKeycloakConfigured();
  // After TOTP enrolment, a login without a second factor, or a step-up request: force a full re-authentication.
  const reauth = error === "mfa_required" || stepUp ? "&reauth=1" : "";

  return (
    <AuthFrame>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">
        {stepUp ? "Confirm it is you" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        Access is verified on every request. You will sign in with your company account and a one-time code
        from your authenticator app.
      </p>

      {stepUp && !error && (
        <Notice tone="warn">
          Additional verification is required for this page. Please confirm it is you with your password and a new
          one-time code.
        </Notice>
      )}
      {signedOut && !error && <Notice tone="good">You have been signed out.</Notice>}
      {error && <Notice tone="bad">{ERROR_MESSAGES[error] ?? ERROR_MESSAGES.internal_error}</Notice>}

      {configured ? (
        <a href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}${reauth}`} className={`mt-8 w-full ${PRIMARY_BUTTON}`}>
          <KeyRound className="size-4" />
          {reauth ? "Sign in again with a one-time code" : "Continue to secure sign-in"}
        </a>
      ) : (
        <Notice tone="warn">
          The identity provider is not configured. Set the <code>KEYCLOAK_*</code> values in <code>.env</code>.
        </Notice>
      )}

      <ul className="mt-8 space-y-2.5 border-t border-line pt-6 text-sm text-muted">
        <li className="flex items-center gap-2.5">
          <Fingerprint className="size-4 text-brand" /> Password and one-time code, every time
        </li>
        <li className="flex items-center gap-2.5">
          <MonitorSmartphone className="size-4 text-brand" /> Your device is checked before you get in
        </li>
      </ul>

      <Link href="/" className="mt-6 inline-block text-sm text-muted underline-offset-4 hover:underline">
        System status
      </Link>
    </AuthFrame>
  );
}
