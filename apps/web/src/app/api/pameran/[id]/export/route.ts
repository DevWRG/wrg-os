import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

import { idAman, type Ctx } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Export SEMUA pengunjung satu pameran sebagai CSV (BOM UTF-8 supaya Excel membaca huruf
// dengan benar). Dibangun di server dari mode `semua=1` — bukan dari halaman tabel klien
// yang cuma memuat 50 baris.
const sel = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: Request, ctx: Ctx) {
  const g = await requireFeature("/pameran", "view");
  if (!g.ok) return g.res;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak sah" }, { status: 400 });
  const res = await gatewayFetch(`/pameran/${id}/pengunjung?semua=1`, { headers: { "x-user-id": g.me.id } });
  if (!res.ok) return new Response(await res.text(), { status: res.status });
  const d = (await res.json()) as { items: Record<string, unknown>[] };
  const kepala = ["Waktu daftar", "Nama", "Institusi", "No. HP", "Kode kupon", "Hadiah", "Status undian", "Deal"];
  const baris = d.items.map((r) => [
    new Date(String(r.daftar_at)).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }),
    r.nama, r.institusi, r.no_hp, r.kode_kupon, r.hadiah, r.status_undian, r.deal_id,
  ].map(sel).join(","));
  const nama = (new URL(req.url).searchParams.get("nama") ?? `pameran-${id}`).replace(/[^a-z0-9-]/gi, "-").slice(0, 60);
  return new Response("﻿" + [kepala.join(","), ...baris].join("\r\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="pengunjung-${nama}.csv"`,
      "cache-control": "no-store",
    },
  });
}
