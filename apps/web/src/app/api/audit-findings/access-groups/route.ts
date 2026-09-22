import { gatewayFetch, relay } from "@/lib/gateway";
import { requireDirekturOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Proxy tipis ke /admin/access/groups (rbac.ts) DENGAN gate requireDirekturOrAdmin
// (bukan requireAdmin seperti /api/admin/access/groups) — F60 owner-nya Direktur,
// dan requireAdmin akan memblokir akun role='direktur' yang belum jadi anggota
// grup superuser. Backend & data sama persis, cuma gate-nya beda audiens.
export async function GET() {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;
  return relay(await gatewayFetch("/admin/access/groups"));
}
