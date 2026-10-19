import { MonitorSmartphone } from "lucide-react";
import { AuthFrame } from "@/components/shell/AuthFrame";
import { PostureCheck } from "@/components/device/PostureCheck";
import { safeReturnTo } from "@/server/auth/login";
import { requireSession } from "@/server/session/current";

export const metadata = { title: "Checking device · Trust Guard" };

export default async function VerifyDevicePage({ searchParams }: PageProps<"/verify-device">) {
  const raw = (await searchParams).returnTo;
  const returnTo = safeReturnTo(Array.isArray(raw) ? raw[0] : raw);
  await requireSession(returnTo);

  return (
    <AuthFrame>
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
        <MonitorSmartphone className="size-6" />
      </span>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">Verifying your device</h1>
      <p className="mt-2 text-sm text-muted">
        Access depends on the health of the device you are using. Trust Guard checks your browser, operating
        system and connection before continuing.
      </p>
      <PostureCheck returnTo={returnTo} />
      <noscript>
        <p className="mt-6 text-sm text-rose-700">JavaScript is required to verify your device.</p>
      </noscript>
    </AuthFrame>
  );
}
