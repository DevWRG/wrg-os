import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Master HoD (migrasi 198) untuk dropdown/label HoD di semua menu. Cukup login:
// isinya nama + peran HoD, tak ada yang sensitif, dan dipakai form yang diisi
// semua karyawan (lembur, fund request).
export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return relay(await gatewayFetch("/hods"));
}
