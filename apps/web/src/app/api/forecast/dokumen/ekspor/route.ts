import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Excel dokumen cabang (filter status/bulan, atau satu dokumen ?id=). Respons BINER — galat tetap JSON.
export async function GET(req: Request) {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "bulan", "id"]) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  try {
    const res = await gatewayFetch(`/forecast/dokumen.xlsx${qs.size ? `?${qs}` : ""}`);
    if (!res.ok) return Response.json(await res.json().catch(() => ({ error: "gagal ekspor" })), { status: res.status });
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "attachment",
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
