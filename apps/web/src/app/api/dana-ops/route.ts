import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F51 Dana Ops / Petty Cash Realization — gateway → apps/api /dana-ops.
// Role min HOD (uang operasional) — ditegakkan di sini, bukan hanya nav.ts.
export async function GET(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/dana-ops${qs}`);
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/dana-ops", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, created_by: guard.me.email ?? null }),
  });
  return relay(res);
}
