import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/dokumen/:id/hitung-ulang (F19): rata-rata
// penjualan + usulan sistem baris draft dihitung ulang dengan rentang baru.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/forecast-submission", "edit");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  let body: { dari?: unknown; sampai?: unknown; jenis?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/forecast/dokumen/${encodeURIComponent(id)}/hitung-ulang`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dari: body.dari, sampai: body.sampai, jenis: body.jenis }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
