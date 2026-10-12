// Gerbang bersama route BFF F65 Leads. gatewayFetch menyuntik x-service-token
// yang mem-bypass JWT di apps/api, jadi izin menu WAJIB dicek di sini
// (requireFeature "/leads"); row-level scope (AM = miliknya, HoD = cabang tim)
// ditegakkan apps/api dari x-user-id — identitas & `oleh` SELALU dari sesi,
// tak pernah dari body browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d+$/.test(id) ? id : null);

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH", aksi: Action): Promise<Response> {
  const g = await requireFeature("/leads", aksi);
  if (!g.ok) return g.res;
  const headers: Record<string, string> = { "x-user-id": g.me.id };
  let body: string | undefined;
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
  return relay(await gatewayFetch(path, { method, headers, body }));
}
