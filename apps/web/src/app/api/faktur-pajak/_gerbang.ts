// Gerbang bersama route BFF F27 Faktur Pajak — pola sama dengan F56/F18: izin menu dicek di sini
// (requireFeature "/faktur-pajak"); pelaku `oleh` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,15}$/.test(id) ? id : null);

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH", aksi: Action): Promise<Response> {
  const g = await requireFeature("/faktur-pajak", aksi);
  if (!g.ok) return g.res;
  let body: string | undefined;
  const headers: Record<string, string> = {};
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
