import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /riwayat-alat/alat/:kunci (F176). Kunci = SN dinormalisasi; di-encode ulang supaya
// "/" atau "%2F" di SN tak bisa keluar dari segmen path (Next sudah men-decode params).
export async function GET(_req: Request, ctx: { params: Promise<{ kunci: string }> }) {
  const guard = await requireFeature("/riwayat-alat", "view");
  if (!guard.ok) return guard.res;
  const { kunci } = await ctx.params;
  if (!kunci || kunci.length > 80) return Response.json({ error: "SN tidak valid" }, { status: 400 });
  try {
    return relay(await gatewayFetch(`/riwayat-alat/alat/${encodeURIComponent(kunci)}`, { headers: { "x-user-id": guard.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
