import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Pratinjau teks rekap WA mingguan (dry-run, tak mengirim). Izin UBAH menu — sama dengan
// pengatur ambang; isinya ringkasan yang sama dengan daftar.
export async function GET() {
  const g = await requireFeature("/do-belum-faktur", "edit");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch("/do-belum-faktur/rekap-pratinjau")); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
