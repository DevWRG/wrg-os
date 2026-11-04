import { requireAdmin } from "@/lib/admin-guard";
import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Papan status job terjadwal (migrasi 275) — admin/superuser saja.
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  return relay(await gatewayFetch("/jobs/status"));
}
