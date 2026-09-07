import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api /picform/* (data 6 form PIC Divisi, migrasi 168/170/171).
// HANYA GET: datanya masuk lewat scripts/ops/pic-form-to-json.py →
// pic-form-import.mjs, tak ada jalur tulis lewat HTTP sama sekali.
//
// Ada supaya tabel langkah SOP (436 baris) & RACI posisi (283 baris) diambil
// per halaman SAAT tab-nya dibuka, bukan ikut terkirim di payload halaman.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = ((await ctx.params).path ?? []).join("/");
  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await gatewayFetch(`/picform/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
