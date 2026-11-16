import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/generate (F19). Body opsional: rentang
// rata-rata penjualan { dari, sampai } (YYYY-MM-DD; kosong = 6 bulan terakhir),
// jenis penjualan (semua/kso/regular), dan brand (kosong = semua brand).
export async function POST(req: Request) {
  const guard = await requireFeature("/forecast-submission", "create");
  if (!guard.ok) return guard.res;
  let body: { dari?: unknown; sampai?: unknown; jenis?: unknown; brand?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* opsional */
  }
  try {
    const res = await gatewayFetch("/forecast/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dari: body.dari, sampai: body.sampai, jenis: body.jenis, brand: body.brand }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
