// Gerbang bersama route BFF F156 Arsip Dokumen. gatewayFetch menyuntik
// x-service-token yang mem-bypass JWT di apps/api, jadi izin WAJIB dicek di
// sini: menu "/arsip-dokumen" + aksi (lihat/buat/ubah/hapus), kode buku = admin.
// `oleh` SELALU dari sesi, tak pernah dari body browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature, type GuardResult } from "@/lib/feature-guard";
import { canAturBukuArsip } from "@/lib/arsip-dokumen-access";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,12}$/.test(id) ? id : null);

export const gerbang = (aksi: Action): Promise<GuardResult> => requireFeature("/arsip-dokumen", aksi);

const putus = () => Response.json({ error: "backend unreachable" }, { status: 502 });

/** GET JSON (lihat). */
export async function teruskanGet(path: string): Promise<Response> {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch(path)); } catch { return putus(); }
}

/** Tulis JSON; `oleh` dari sesi. aksi "buku" = kode buku (admin/superuser saja). */
export async function teruskanJson(req: Request, path: string, method: "POST" | "PATCH", aksi: Action | "buku"): Promise<Response> {
  const g = await gerbang(aksi === "buku" ? "view" : aksi);
  if (!g.ok) return g.res;
  if (aksi === "buku" && !canAturBukuArsip(g.me)) {
    return Response.json({ error: "forbidden — kode buku hanya diatur admin" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    const t = await req.text();
    body = t ? (JSON.parse(t) as Record<string, unknown>) : {};
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(await gatewayFetch(path, {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, oleh: actorName(g.me) }),
    }));
  } catch { return putus(); }
}

export { actorName, gatewayFetch, relay, putus };
