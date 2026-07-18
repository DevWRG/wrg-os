import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Daftar raport semua karyawan — HANYA admin/HoD.
export async function GET(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const period = new URL(req.url).searchParams.get("period");
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  try {
    return relay(await gatewayFetch(`/raport/list${qs}`, { headers: { "x-user-id": guard.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
