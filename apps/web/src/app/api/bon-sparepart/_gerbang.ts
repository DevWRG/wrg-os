// Gerbang bersama route BFF F155 Bon Sparepart — izin menu di sini (requireFeature
// "/bon-sparepart"; aksi tulis = edit); pelaku `oleh` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import { canEditBonSparepart } from "@/lib/bon-sparepart-access";

export const idAman = (id: string) => (/^\d{1,12}$/.test(id) ? id : null);

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH"): Promise<Response> {
  const g = await requireFeature("/bon-sparepart", method === "GET" ? "view" : "edit");
  if (!g.ok) return g.res;
  if (method !== "GET" && !canEditBonSparepart(g.me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: string | undefined;
  const headers: Record<string, string> = { "x-user-id": g.me.id };
  if (method !== "GET") {
    let isi: Record<string, unknown> = {};
    if (req) {
      try {
        const t = await req.text();
        isi = t ? (JSON.parse(t) as Record<string, unknown>) : {};
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }
    }
    headers["content-type"] = "application/json";
    body = JSON.stringify({ ...isi, oleh: actorName(g.me) });
  }
  try {
    return relay(await gatewayFetch(path, { method, headers, body }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
