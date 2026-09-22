import { gatewayFetch, relay } from "@/lib/gateway";
import { requireDirekturOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F60 — chain-config murni admin/direktur, TIDAK bisa dilonggarkan lewat
// Akses Grup (lihat audit-finding-access.ts) — mengatur SIAPA jadi approver
// tiap layer adalah kapabilitas keamanan.
export async function GET() {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/audit-findings/chain-config"));
}
