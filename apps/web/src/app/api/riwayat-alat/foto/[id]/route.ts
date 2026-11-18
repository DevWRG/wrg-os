import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /riwayat-alat/foto/:id (336) — foto #REPORT teknisi per ID, untuk menu Riwayat Alat.
// Sengaja TIDAK lewat /api/media (izin Visits, buka path apa pun di root WA): di sini hanya foto laporan teknisi.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/riwayat-alat", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  if (!/^\d{1,15}$/.test(id)) return Response.json({ error: "id tidak valid" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/riwayat-alat/foto/${id}`, { headers: { "x-user-id": guard.me.id } });
    if (!res.ok) return Response.json({ error: "foto tak tersedia" }, { status: res.status });
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
