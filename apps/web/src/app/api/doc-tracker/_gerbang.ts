// Gerbang bersama route BFF DOC Document Tracker. gatewayFetch menyuntik x-service-token yang mem-bypass
// JWT di apps/api, jadi izin menu WAJIB dicek di sini (requireFeature "/doc-tracker": view = baca,
// edit = stempel/checklist/tautan faktur). Pemberi stempel `by` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,15}$/.test(id) ? id : null);
export const tolak = (status: number, error: string) => Response.json({ error }, { status });

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST", aksi: Action): Promise<Response> {
  const g = await requireFeature("/doc-tracker", aksi);
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
        return tolak(400, "invalid JSON body");
      }
    }
    headers["content-type"] = "application/json";
    body = JSON.stringify({ ...isi, by: actorName(g.me) });
  }
  try {
    return relay(await gatewayFetch(path, { method, headers, body }));
  } catch {
    return tolak(502, "backend unreachable");
  }
}
