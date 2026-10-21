import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Tab "Revenue Area" WatchPoint (F76 + F150). Izin = menu WatchPoint; papan WatchPoint
// memang menampilkan semua HoD, jadi tab ini juga semua area (tanpa filter ?hod).
export async function GET(req: Request) {
  const g = await requireFeature("/watchpoint", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  const periode = src.get("periode");
  if (periode === "bulan" || periode === "kuartal" || periode === "tahun") qs.set("periode", periode);
  try {
    return relay(await gatewayFetch(`/revenue-area${qs.size ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
