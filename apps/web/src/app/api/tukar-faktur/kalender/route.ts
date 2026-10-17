// F31 — BFF read-only kalender klinik. Izin diperiksa di sini (lihat ../route.ts).
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewTukarFaktur } from "@/lib/tukar-faktur-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewTukarFaktur(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const bulan = new URL(req.url).searchParams.get("bulan");
  try {
    return relay(await gatewayFetch(`/tukar-faktur/kalender${bulan ? `?bulan=${encodeURIComponent(bulan)}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
