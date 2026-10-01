import Link from "next/link";
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
  internal_error: "Something went wrong while signing you in.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const returnTo = safeReturnTo(one(params.returnTo));
  const error = one(params.error);
  const signedOut = one(params.signed_out) === "1";

  if (await getCurrentSession()) redirect(returnTo);

  const configured = isKeycloakConfigured();
  // After TOTP enrolment (or any login without a second factor) force a full re-authentication.
  const reauth = error === "mfa_required" ? "&reauth=1" : "";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Sign in</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Access is verified on every request. You will sign in with your company account and a
        one-time code from your authenticator app.
      </p>

      {signedOut && !error && (
        <p className="mt-6 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          You have been signed out.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.internal_error}
        </p>
      )}

      {configured ? (
        <a
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}${reauth}`}
          className="mt-8 inline-flex justify-center rounded-md bg-slate-900 px-4 py-2.5 font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
        >
          {reauth ? "Sign in again with a one-time code" : "Continue to secure sign-in"}
        </a>
      ) : (
        <p className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          The identity provider is not configured. Set the <code>KEYCLOAK_*</code> values in{" "}
          <code>.env</code>.
        </p>
      )}

      <Link href="/" className="mt-6 text-sm text-slate-500 underline-offset-4 hover:underline">
        System status
      </Link>
    </main>
  );
}
