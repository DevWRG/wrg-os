import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import { izinAksi } from "@/lib/register-cek-access";

export const dynamic = "force-dynamic";

// Ubah status cek. Izin per aksi: setujui/tolak = UBAH (HoD Finance), lainnya = TAMBAH (kasir).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "id tidak sah" }, { status: 400 });
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  const aksi = String(b.aksi ?? "");
  const izin = izinAksi(aksi);
  if (!izin) return Response.json({ error: "aksi tidak dikenal" }, { status: 400 });
  const g = await requireFeature("/register-cek", izin);
  if (!g.ok) return g.res;
  try {
    return relay(await gatewayFetch(`/cek-keluar/${id}/aksi`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ aksi, catatan: b.catatan, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
