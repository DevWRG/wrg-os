import { gatewayFetch, gerbang, putus, relay } from "../_gerbang";

export const dynamic = "force-dynamic";

// Laporan Excel Proyek HD. Respons BINER — jangan lewat relay() kecuali galat.
export async function GET() {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/proyek-hd/ekspor.xlsx");
    if (!res.ok) return relay(res);
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "attachment",
        "cache-control": "private, no-store",
      },
    });
  } catch { return putus(); }
}
