import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F110 — PDF Pre-Meeting Briefing dari Senin Brief F85. Gerbang = menu
// /briefings (sama dengan halaman yang menampilkan briefnya). Tahun & minggu ISO
// numerik; tombol di tab Senin Brief memakai brief yang sedang dipilih.
export async function GET(_req: Request, ctx: { params: Promise<{ tahun: string; minggu: string }> }) {
  const g = await requireFeature("/briefings");
  if (!g.ok) return g.res;
  const { tahun, minggu } = await ctx.params;
  if (!/^\d{4}$/.test(tahun) || !/^\d{1,2}$/.test(minggu)) {
    return Response.json({ error: "tahun/minggu tak valid" }, { status: 400 });
  }
  try {
    // Nama pencetak dari SESI, bukan dari browser — footer dokumen tak boleh
    // bisa diisi sembarang nama.
    const oleh = encodeURIComponent(g.me.name || g.me.email || "");
    const res = await gatewayFetch(`/senin-brief/${tahun}/${minggu}/pdf?oleh=${oleh}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "gagal membuat PDF" }));
      return Response.json(data, { status: res.status });
    }
    // Biner apa adanya — jangan lewat relay() (JSON.parse merusak file).
    return new Response(res.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": res.headers.get("content-disposition") ?? 'attachment; filename="pre-meeting-briefing.pdf"',
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
