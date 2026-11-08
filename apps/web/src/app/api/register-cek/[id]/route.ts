import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Ubah data cek berstatus draft — izin TAMBAH (pemilik input).
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/register-cek", "create");
  if (!g.ok) return g.res;
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "id tidak sah" }, { status: 400 });
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch(`/cek-keluar/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...b, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
