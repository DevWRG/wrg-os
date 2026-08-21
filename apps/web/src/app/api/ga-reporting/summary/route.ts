import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F141 GA Reporting & Analytics Dashboard — gateway → apps/api /ga-reporting/summary.
// Role min HOD (konsolidasi data 6 modul GA, sebagian sumber HOD-gated) —
// ditegakkan di sini, bukan hanya nav.ts (pola sama dana-ops/vendor-management).
export async function GET(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const qs = new URL(req.url).search;
  const res = await gatewayFetch(`/ga-reporting/summary${qs}`);
  return relay(res);
}
