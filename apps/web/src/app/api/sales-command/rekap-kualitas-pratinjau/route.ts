import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { salesCommandAccess } from "@/lib/sales-command-access";

export const dynamic = "force-dynamic";

// Pratinjau rekap WA mingguan kualitas data ke HoD (dry-run, tak mengirim). Gerbang
// sama dengan /api/sales-command; region ditentukan API dari sesi.
export async function GET(req: Request) {
  const g = await requireFeature("/sales-command", "view");
  if (!g.ok) return g.res;
  const region = new URL(req.url).searchParams.get("region");
  const q = salesCommandAccess(g.me) === "full" && (region === "East" || region === "West") ? `?region=${region}` : "";
  try {
    return relay(await gatewayFetch(`/sales-command/rekap-kualitas-pratinjau${q}`, { headers: { "x-user-id": g.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
