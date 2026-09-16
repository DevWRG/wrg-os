import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api /stock/* (F37). Read-only: data stok per gudang masuk lewat
// importer (scripts/db/import_stock_branch.py), bukan lewat HTTP — jadi proxy
// ini sengaja hanya meneruskan GET.
//
// Ada supaya tab "Per Gudang" bisa mengambil datanya SAAT DIBUKA, bukan ikut
// terkirim di payload halaman. Tanpa ini seluruh matriks (~1,3 MB pada katalog
// 5.800 item) ditanggung juga oleh orang yang cuma memakai tab "Semua Stok".
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = ((await ctx.params).path ?? []).join("/");
  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await gatewayFetch(`/stock/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
