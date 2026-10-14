// Gerbang bersama route BFF F56 Onboarding — pola sama dengan F18/F65: izin menu dicek di sini
// (requireFeature "/onboarding"), audiens baris & template ditegakkan apps/api dari x-user-id;
// pelaku `oleh` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,15}$/.test(id) ? id : null);

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH", aksi: Action): Promise<Response> {
  const g = await requireFeature("/onboarding", aksi);
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
  try {
    return relay(await gatewayFetch(path, { method, headers, body }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
