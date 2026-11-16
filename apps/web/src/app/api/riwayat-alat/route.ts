import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /riwayat-alat/alat (F176, menu Riwayat Alat). Semua pemegang menu melihat semua alat.
export async function GET() {
  const guard = await requireFeature("/riwayat-alat", "view");
  if (!guard.ok) return guard.res;
  try {
    return relay(await gatewayFetch("/riwayat-alat/alat", { headers: { "x-user-id": guard.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
