import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { laporanByKey } from "@/lib/report-library";

export const dynamic = "force-dynamic";

// F92 — PDF satu laporan. Gerbang = menu sumber laporan (lihat ../route.ts).
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const l = laporanByKey(key);
  if (!l) return Response.json({ error: "laporan tak dikenal" }, { status: 404 });
  const g = await requireFeature(l.menu);
  if (!g.ok) return g.res;
  try {
    // Nama pencetak dari SESI, bukan dari browser — footer dokumen tak boleh bisa diisi sembarang.
    const oleh = encodeURIComponent(g.me.name || g.me.email || "");
    const res = await gatewayFetch(`/report-library/${l.key}/pdf?oleh=${oleh}`, { headers: { "x-user-id": g.me.id } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: "gagal membuat PDF" }));
      return Response.json(data, { status: res.status });
    }
    // Biner apa adanya — jangan lewat relay() (JSON.parse merusak file).
    return new Response(res.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": res.headers.get("content-disposition") ?? `attachment; filename="${l.key}.pdf"`,
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
