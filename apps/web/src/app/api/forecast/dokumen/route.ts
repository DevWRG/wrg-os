import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /forecast/dokumen (F19, dokumen cabang × kategori × bulan).
export async function GET(req: Request) {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "bulan", "brand"]) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  try {
    // x-user-id → API menghitung bolehReview per dokumen untuk pemakai ini.
    const res = await gatewayFetch(`/forecast/dokumen${qs.size ? `?${qs}` : ""}`, { headers: { "x-user-id": guard.me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
