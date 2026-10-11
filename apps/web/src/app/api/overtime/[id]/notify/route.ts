import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Kirim ulang notifikasi ke HoD (mis. setelah nomor WA HoD baru diisi).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/overtime/${encodeURIComponent(id)}/notify`, { method: "POST" });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
