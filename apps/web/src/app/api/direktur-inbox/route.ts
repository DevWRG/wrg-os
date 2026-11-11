// F59 — BFF read-only. gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api,
// jadi izin WAJIB diperiksa di sini sebelum meneruskan (menyembunyikan menu tidak menutup endpoint).
// Sengaja tidak ada route untuk /direktur-inbox/run: itu bisa mengirim WA ke Direktur.
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewDirekturInbox } from "@/lib/direktur-inbox-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewDirekturInbox(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return relay(await gatewayFetch("/direktur-inbox"));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
