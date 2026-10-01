import { getSystemHealth } from "@/server/health/checks";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getSystemHealth();
  return Response.json(health, {
    status: health.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
