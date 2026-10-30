// Gerbang bersama route BFF F173 Pameran. Izin menu dicek di sini (requireFeature "/pameran"
// + aksi). gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api, jadi
// gerbang ini WAJIB. `oleh` SELALU dari sesi, tak pernah dari body browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d+$/.test(id) ? id : null);
export type Ctx = { params: Promise<{ id: string }> };

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH" | "DELETE", aksi: Action): Promise<Response> {
  const g = await requireFeature("/pameran", aksi);
  if (!g.ok) return g.res;
  const headers: Record<string, string> = { "x-user-id": g.me.id };
  let body: string | undefined;
  if (method === "POST" || method === "PATCH") {
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

/** Teruskan query string yang diizinkan saja (encode ulang). */
export function qsDari(req: Request, kunci: readonly string[]): string {
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of kunci) { const v = src.get(k); if (v) qs.set(k, v); }
  return qs.size ? `?${qs}` : "";
}
