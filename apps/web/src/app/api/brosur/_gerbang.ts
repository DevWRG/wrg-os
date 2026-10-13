// Gerbang bersama route BFF F130 Brosur & Video. gatewayFetch menyuntik
// x-service-token yang mem-bypass JWT di apps/api, jadi izin menu WAJIB dicek
// di sini (requireFeature "/brosur"). FormData disusun ulang (bukan diteruskan
// mentah) supaya boundary dibuat fetch sendiri dan `oleh` selalu dari sesi.
import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d+$/.test(id) ? id : null);
const FIELD = ["jenis", "judul", "brand", "kategori", "produk", "url", "catatan", "aktif", "cek_ulang"];

export async function teruskan(req: Request | null, path: string, method: "GET" | "POST" | "PATCH", aksi: Action): Promise<Response> {
  const g = await requireFeature("/brosur", aksi);
  if (!g.ok) return g.res;
  let body: FormData | undefined;
  if (method !== "GET" && req) {
    let masuk: FormData;
    try {
      masuk = await req.formData();
    } catch {
      return Response.json({ error: "invalid multipart body" }, { status: 400 });
    }
    body = new FormData();
    for (const k of FIELD) {
      const v = masuk.get(k);
      if (typeof v === "string") body.set(k, v);
    }
    const f = masuk.get("file");
    if (f instanceof File && f.size > 0) body.set("file", f);
    body.set("oleh", actorName(g.me));
  }
  try {
    return relay(await gatewayFetch(path, { method, headers: { "x-user-id": g.me.id }, body }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
