import { requireAdmin } from "@/lib/admin-guard";
import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Peta layanan di /status-job (status proses server + ringkasan job) — admin/superuser saja.
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  return relay(await gatewayFetch("/ops/peta-layanan"));
}
