import { canLihatMarginHd } from "@/lib/proyek-hd-access";
import { gatewayFetch, gerbang, putus, relay } from "../_gerbang";

export const dynamic = "force-dynamic";

type Baris = { id: number; kode: string; nama_rs: string; unit_kso: number; harga_unit: number | null };

// Daftar proyek untuk pemilih di simulator — hanya kolom yang dipakai simulator, bukan seluruh
// data tracker. Harga unit (isi awal harga mesin di tab Margin) hanya untuk pemegang margin.
export async function GET() {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/proyek-hd");
    if (!res.ok) return relay(res);
    const d = (await res.json()) as { items: Baris[] };
    const margin = canLihatMarginHd(g.me);
    return Response.json({
      items: d.items.map((p) => ({ id: p.id, kode: p.kode, nama_rs: p.nama_rs, unit_kso: p.unit_kso, harga_unit: margin ? p.harga_unit : null })),
    });
  } catch { return putus(); }
}
