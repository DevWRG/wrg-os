// Gerbang bersama route BFF Proyek HD. gatewayFetch menyuntik x-service-token yang
// mem-bypass JWT di apps/api, jadi izin WAJIB dicek di sini: menu "/proyek-hd" + aksi
// (lihat/buat/ubah), dan kunci 'proyek-hd-margin' untuk apa pun yang memuat harga,
// biaya, atau margin WRG. `oleh` SELALU dari sesi, tak pernah dari body browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature, type GuardResult } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const idAman = (id: string) => (/^\d{1,12}$/.test(id) ? id : null);
/** Slug tab data operasional (konstruksi, kurva-s, …) — daftar sahnya dicek ulang di API. */
export const slugAman = (s: string) => (/^[a-z][a-z-]{1,19}$/.test(s) ? s : null);

export const gerbang = (aksi: Action): Promise<GuardResult> => requireFeature("/proyek-hd", aksi);

export const putus = () => Response.json({ error: "backend unreachable" }, { status: 502 });

/** GET JSON (lihat). */
export async function teruskanGet(path: string): Promise<Response> {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try { return relay(await gatewayFetch(path)); } catch { return putus(); }
}

export async function bacaJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const t = await req.text();
    const v = t ? JSON.parse(t) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

/** Tulis JSON; `oleh` dari sesi. */
export async function teruskanJson(req: Request, path: string, method: "POST" | "PATCH", aksi: Action): Promise<Response> {
  const g = await gerbang(aksi);
  if (!g.ok) return g.res;
  const body = await bacaJson(req);
  if (!body) return Response.json({ error: "invalid JSON body" }, { status: 400 });
  try {
    return relay(await gatewayFetch(path, {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, oleh: actorName(g.me) }),
    }));
  } catch { return putus(); }
}

/** Catatan / maju tahap: FormData dibangun ulang (boundary lama tak terbawa), kolom whitelist + berkas, `oleh` dari sesi. */
export async function teruskanMultipart(req: Request, path: string, kolom: readonly string[]): Promise<Response> {
  const g = await gerbang("edit");
  if (!g.ok) return g.res;
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ error: "invalid multipart body" }, { status: 400 }); }
  const fd = new FormData();
  for (const f of form.getAll("file")) if (f instanceof File && f.size > 0) fd.append("file", f, f.name);
  for (const k of kolom) fd.set(k, String(form.get(k) ?? ""));
  fd.set("oleh", actorName(g.me));
  try { return relay(await gatewayFetch(path, { method: "POST", body: fd })); } catch { return putus(); }
}

export { actorName, gatewayFetch, relay };
