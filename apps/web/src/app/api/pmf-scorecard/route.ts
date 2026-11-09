// F48 — BFF read-only. gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api,
// jadi izin WAJIB diperiksa di sini sebelum meneruskan (menyembunyikan menu tidak menutup endpoint).
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPmfScorecard } from "@/lib/pmf-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPmfScorecard(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const u = new URL(req.url);
  const q = new URLSearchParams();
  const tahun = u.searchParams.get("tahun");
  const kuartal = u.searchParams.get("kuartal");
  if (tahun && /^\d{4}$/.test(tahun)) q.set("tahun", tahun);
  if (kuartal && /^[1-4]$/.test(kuartal)) q.set("kuartal", kuartal);
  const qs = q.toString();
  return relay(await gatewayFetch(`/pmf-scorecard${qs ? `?${qs}` : ""}`));
}
