import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F13 PO Tracker + Sistem Barang Masuk — gateway → apps/api /purchase-orders.
// Role min Karyawan (semua role login boleh catat & lihat PO/barang masuk).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/purchase-orders${qs}`);
  return relay(res);
}

export async function POST(req: Request) {
  const me = await sessionUser();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/purchase-orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, created_by: me?.email ?? null }),
  });
  return relay(res);
}
