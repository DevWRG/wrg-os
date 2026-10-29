import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { profitabilitasAccess } from "@/lib/profitabilitas-area-access";

export const dynamic = "force-dynamic";

// F150 — revenue per area untuk menu /profitabilitas-area. gatewayFetch mem-bypass JWT di
// apps/api, jadi izin WAJIB dicek di sini. Akses "hod" dibatasi ke cabang HoD itu: `hod`
// diambil dari SESI, input browser diabaikan.
export async function GET(req: Request) {
  const g = await requireFeature("/profitabilitas-area", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  const periode = src.get("periode");
  if (periode === "bulan" || periode === "kuartal" || periode === "tahun") qs.set("periode", periode);
  qs.set("biaya", "1"); // izin profitabilitas-area sudah dicek di atas
  const asOf = src.get("asOf");
  if (asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) qs.set("asOf", asOf);
  if (profitabilitasAccess(g.me) === "hod") {
    // HoD tanpa hod_key tak mungkin lolos (identitas "hod" = punya hod_key), tapi jangan
    // pernah jatuh ke "semua area" kalau kosong.
    if (!g.me.hod_key) return Response.json({ error: "forbidden" }, { status: 403 });
    qs.set("hod", g.me.hod_key);
  }
  try {
    return relay(await gatewayFetch(`/revenue-area${qs.size ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
