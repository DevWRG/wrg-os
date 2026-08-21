import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// F40 Inventory Relocation Request — gateway → apps/api /inventory-relocations.
// Role min HOD: requireHodOrAdmin() enforce nyata di sini (bukan cuma nav.ts),
// pola sama dgn dana-ops F51 (butuh HOD/admin, beda dari F39/F134 yg Karyawan).
export async function GET() {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  const res = await gatewayFetch("/inventory-relocations");
  return relay(res);
}

export async function POST(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const res = await gatewayFetch("/inventory-relocations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}
