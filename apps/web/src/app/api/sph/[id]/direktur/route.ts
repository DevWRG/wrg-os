import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /sph/:id/direktur (F15 — persetujuan Direktur atas
// diskon jenjang "direktur", migrasi 301). Gerbang menu (view Sales Docs) di
// sini, sama dgn review HoD; syarat role direktur / superuser + bukan pembuat
// ditegakkan apps/api dari x-user-id (sesi). Body tidak diteruskan.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/sph/${encodeURIComponent(id)}/direktur`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: "{}",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
