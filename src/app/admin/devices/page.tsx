import { ActionButton } from "@/components/admin/ActionButton";
import { AdminShell, flashFrom, formatTime, TABLE, TableFrame, TD, THead } from "@/components/admin/AdminShell";
import { Pill, type Tone } from "@/components/ui/cards";
import { evaluatePosture } from "@/server/device-posture/evaluate";
import { adminPageContext } from "@/server/admin/page-context";
import { listDevices } from "@/server/admin/queries";

export const metadata = { title: "Devices · Admin · Trust Guard" };

const STATUS_TONE: Record<string, Tone> = { trusted: "good", registered: "neutral", blocked: "bad" };

export default async function AdminDevicesPage({ searchParams }: PageProps<"/admin/devices">) {
  const { ctx, manage, canManage } = await adminPageContext("/admin/devices");
  const devices = await listDevices();

  return (
    <AdminShell active="/admin/devices" ctx={ctx} manage={manage} flash={flashFrom(await searchParams)}>
      <h2 className="mb-1 text-sm font-semibold">{devices.length} devices</h2>
      <p className="mb-3 text-sm text-muted">
        <strong>Trusted</strong> devices no longer count as new. <strong>Blocked</strong> devices are denied
        everywhere and their sessions end immediately. Posture is the last report from the browser.
      </p>
      <TableFrame>
        <table className={TABLE}>
          <THead cols={["User", "Device", "Status", "Posture", "Last seen", "Sessions", ""]} />
          <tbody className="divide-y divide-line">
            {devices.map((d) => {
              const failed = d.last_posture
                ? evaluatePosture(d.last_posture, d.last_posture.userAgent).failedChecks
                : null;
              const own = d.id === ctx.session.deviceId;
              return (
                <tr key={d.id}>
                  <td className={TD}>{d.username}</td>
                  <td className={TD}>
                    {d.label ?? "Unknown"}
                    {own && <span className="ml-1 text-xs text-muted">(your device)</span>}
                    <div className="text-xs text-muted">first seen {formatTime(d.first_seen_at)}</div>
                  </td>
                  <td className={TD}>
                    <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill>
                    {d.status_changed_by && (
                      <div className="mt-1 text-xs text-muted">
                        by {d.status_changed_by}, {formatTime(d.status_changed_at)}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} text-xs`}>
                    {failed === null ? "—" : failed.length === 0 ? "compliant" : `failed: ${failed.join(", ")}`}
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    {formatTime(d.last_seen_at)}
                    <div className="font-mono text-xs text-muted">{d.last_ip ?? ""}</div>
                  </td>
                  <td className={`${TD} tabular-nums`}>{d.active_sessions}</td>
                  <td className={TD}>
                    <div className="flex flex-wrap gap-1">
                      {d.status !== "trusted" && (
                        <ActionButton action="trust_device" target={d.id} returnTo="/admin/devices" label="Trust" tone="positive" disabled={!canManage} />
                      )}
                      {d.status !== "blocked" && (
                        <ActionButton
                          action="block_device"
                          target={d.id}
                          returnTo="/admin/devices"
                          label="Block"
                          tone="danger"
                          confirm={`Block ${d.label ?? "this device"} for ${d.username}? Its sessions end immediately.`}
                          disabled={!canManage || own}
                        />
                      )}
                      {d.status !== "registered" && (
                        <ActionButton action="reset_device" target={d.id} returnTo="/admin/devices" label="Reset" disabled={!canManage} />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableFrame>
    </AdminShell>
  );
}
