import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { profitabilitasAccess } from "@/lib/profitabilitas-area-access";

export const dynamic = "force-dynamic";

// Tab "Revenue Area" WatchPoint (F76 + F150). Izin = menu WatchPoint; papan WatchPoint
// memang menampilkan semua HoD, jadi tab ini juga semua area (tanpa filter ?hod).
// Biaya/laba kotor/Kantor Pusat (F150 tahap 2) sensitif: HANYA bila pemanggil punya akses PENUH F150
// (Direktur/admin/superuser). Selain itu tab tetap revenue saja — HoD melihat biaya areanya sendiri di
// /profitabilitas-area, bukan di papan yang memuat semua area.
export async function GET(req: Request) {
  const g = await requireFeature("/watchpoint", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  const periode = src.get("periode");
  if (periode === "bulan" || periode === "kuartal" || periode === "tahun") qs.set("periode", periode);
  if (profitabilitasAccess(g.me) === "full") qs.set("biaya", "1");
  try {
    return relay(await gatewayFetch(`/revenue-area${qs.size ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
