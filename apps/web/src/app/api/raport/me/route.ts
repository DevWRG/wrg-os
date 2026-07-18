import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Raport diri sendiri. Identitas dari sesi (x-user-id), bukan param — apps/api
// resolve am_id sendiri. Cegah akses raport orang lain.
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const period = new URL(req.url).searchParams.get("period");
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  try {
    return relay(await gatewayFetch(`/raport/me${qs}`, { headers: { "x-user-id": me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
