import { gatewayFetch, relay } from "@/lib/gateway";
import { featureAllowed, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sph/:id/konteks (F15): aksi yang boleh dilakukan
// penonton + alasan bila tidak, nama pembuat, riwayat. Gerbang: lihat Sales
// Docs. Hanya penjelas layar — route aksi tetap memeriksa izin sendiri.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    return relay(
      await gatewayFetch(`/sph/${encodeURIComponent(id)}/konteks`, {
        headers: { "x-user-id": g.me.id, "x-bisa-edit": featureAllowed(g.me, "/sales-docs", "edit") ? "1" : "0" },
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
