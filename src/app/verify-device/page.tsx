import { PostureCheck } from "@/components/device/PostureCheck";
import { safeReturnTo } from "@/server/auth/login";
import { requireSession } from "@/server/session/current";

export const metadata = { title: "Checking device · Trust Guard" };

export default async function VerifyDevicePage({ searchParams }: PageProps<"/verify-device">) {
  const raw = (await searchParams).returnTo;
  const returnTo = safeReturnTo(Array.isArray(raw) ? raw[0] : raw);
  await requireSession(returnTo);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12">
      <p className="text-sm font-medium uppercase tracking-wide text-slate-500">Trust Guard</p>
      <h1 className="mt-1 text-3xl font-bold tracking-tight">Verifying your device</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Access depends on the health of the device you are using. Trust Guard checks your browser,
        operating system and connection before continuing.
      </p>
      <PostureCheck returnTo={returnTo} />
      <noscript>
        <p className="mt-6 text-sm text-red-700">JavaScript is required to verify your device.</p>
      </noscript>
    </main>
  );
}
