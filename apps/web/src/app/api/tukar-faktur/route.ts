// F31 — BFF read-only. gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api,
// jadi izin WAJIB diperiksa di sini sebelum meneruskan (menyembunyikan menu tidak menutup endpoint).
// `hari` diteruskan apa adanya; apps/api yang memvalidasi (400 bila salah).
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewTukarFaktur } from "@/lib/tukar-faktur-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewTukarFaktur(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const hari = new URL(req.url).searchParams.get("hari");
  try {
    return relay(await gatewayFetch(`/tukar-faktur${hari ? `?hari=${encodeURIComponent(hari)}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
