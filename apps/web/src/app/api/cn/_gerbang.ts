// Gerbang bersama route BFF F151 CN (Kredit Note). gatewayFetch menyuntik x-service-token yang mem-bypass
// JWT di apps/api, jadi izin menu WAJIB dicek di sini (requireFeature "/cn": create = buat kontrak/ajukan,
// edit = geser status). Hak per TAHAP (HoD/Finance/GA) dicek di sini juga: lihat lib/cn-access.ts.
// Pelaku `oleh` SELALU dari sesi, tak pernah dari body.
import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature, actorName } from "@/lib/feature-guard";
import type { SessionUserSrv } from "@/lib/admin-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,15}$/.test(id) ? id : null);

export const tolak = (status: number, error: string) => Response.json({ error }, { status });

/** `periksa` (opsional) menjalankan cek hak tambahan atas body & sesi; kembalikan Response untuk menolak, null untuk lanjut. */
export async function teruskan(
  req: Request | null, path: string, method: "GET" | "POST", aksi: Action,
  periksa?: (me: SessionUserSrv, body: Record<string, unknown>) => Promise<Response | null> | Response | null,
): Promise<Response> {
  const g = await requireFeature("/cn", aksi);
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
    if (periksa) {
      const r = await periksa(g.me, isi);
      if (r) return r;
    }
    headers["content-type"] = "application/json";
    body = JSON.stringify({ ...isi, oleh: actorName(g.me) });
  }
  try {
    return relay(await gatewayFetch(path, { method, headers, body }));
  } catch {
    return tolak(502, "backend unreachable");
  }
}
