import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F36 Inbound Receiving Checklist — gateway → apps/api /inbound-receiving.
// Role min Karyawan (semua role login boleh lihat & catat penerimaan).
export async function GET(req: Request) {
  const guard = await requireFeature("/inbound-receiving", "view");
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/inbound-receiving${qs}`);
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireFeature("/inbound-receiving", "create");
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/inbound-receiving", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, created_by: actorName(guard.me) }),
  });
  return relay(res);
}
