import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /shipment-tracking/:id/bukti (F93, audit trail
// tambahan setelah BAST: foto bukti terima + scan tanda tangan).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // semua field opsional
  }
  try {
    const res = await gatewayFetch(`/shipment-tracking/${encodeURIComponent(id)}/bukti`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
