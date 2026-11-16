import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /forecast/dokumen/:id/review (F19, migrasi 326).
// Cukup izin lihat menu: siapa yang boleh memutus (HoD Sales wilayah dokumen,
// cadangan Direktur/admin/superuser) ditegakkan API dari x-user-id sesi.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/forecast-submission", "view");
  if (!guard.ok) return guard.res;
  const { id } = await params;
  let body: { keputusan?: unknown; catatan?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/forecast/dokumen/${encodeURIComponent(id)}/review`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": guard.me.id },
      body: JSON.stringify({ keputusan: body.keputusan, catatan: body.catatan }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
