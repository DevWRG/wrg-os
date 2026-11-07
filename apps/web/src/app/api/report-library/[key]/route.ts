import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { laporanByKey } from "@/lib/report-library";

export const dynamic = "force-dynamic";

// F92 — pratinjau satu laporan (ringkasan + 10 baris). Gerbang = menu SUMBER laporan itu,
// bukan menu Report Library: menu ini tak boleh membuka data yang tak bisa dilihat user
// di halaman aslinya. Scope baris (AM/cabang) ditegakkan API lewat x-user-id dari SESI.
export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const l = laporanByKey(key);
  if (!l) return Response.json({ error: "laporan tak dikenal" }, { status: 404 });
  const g = await requireFeature(l.menu);
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch(`/report-library/${l.key}`, { headers: { "x-user-id": g.me.id } });
    return Response.json(await res.json().catch(() => ({ error: "respons tak valid" })), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
