import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F131 — konfirmasi/tolak kompetitor dominan per wilayah. Gerbang = izin ubah
// menu Competitor Intel; scope (HoD = cabang timnya, AM ditolak) di apps/api
// dari x-user-id; `oleh` dari sesi.
export async function POST(req: Request) {
  const g = await requireFeature("/competitor", "edit");
  if (!g.ok) return g.res;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(await gatewayFetch("/competitor/dominan", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify({ cabang: body.cabang, kategori: body.kategori, vendor: body.vendor, status: body.status, catatan: body.catatan, oleh: actorName(g.me) }),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
