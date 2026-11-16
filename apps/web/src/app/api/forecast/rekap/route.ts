import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /forecast/rekap?bulan=YYYY-MM (rekap Purchasing semua cabang).
export async function GET(req: Request) {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  const sp = new URL(req.url).searchParams;
  const bulan = sp.get("bulan") ?? "";
  const brand = sp.get("brand") ?? "";
  try {
    const res = await gatewayFetch(`/forecast/rekap?bulan=${encodeURIComponent(bulan)}${brand ? `&brand=${encodeURIComponent(brand)}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
