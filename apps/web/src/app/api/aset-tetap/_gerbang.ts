// Gerbang bersama route BFF F34. gatewayFetch menyuntik x-service-token yang
// mem-bypass JWT di apps/api, jadi izin WAJIB diperiksa di sini sebelum
// meneruskan — menyembunyikan tombol di UI tidak menutup endpoint.
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser, type SessionUserSrv } from "@/lib/admin-guard";
import { canEditAsetTetap, canViewAsetTetap } from "@/lib/aset-tetap-access";

type Hasil = { me: SessionUserSrv } | { tolak: Response };

export async function gerbang(perlu: "view" | "edit"): Promise<Hasil> {
  const me = await sessionUser();
  if (!me) return { tolak: Response.json({ error: "unauthenticated" }, { status: 401 }) };
  const boleh = perlu === "edit" ? canEditAsetTetap(me) : canViewAsetTetap(me);
  if (!boleh) return { tolak: Response.json({ error: "forbidden" }, { status: 403 }) };
  return { me };
}

export async function teruskanGet(path: string): Promise<Response> {
  const g = await gerbang("view");
  if ("tolak" in g) return g.tolak;
  return relay(await gatewayFetch(path));
}

/** Teruskan tulis; `oleh` diisi dari SESI, input browser diabaikan. */
export async function teruskanTulis(req: Request | null, path: string, method: "POST" | "PUT"): Promise<Response> {
  const g = await gerbang("edit");
  if ("tolak" in g) return g.tolak;
  let body: Record<string, unknown> = {};
  if (req) {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid JSON body" }, { status: 400 });
    }
  }
  const oleh = g.me.name?.trim() || g.me.email || g.me.id;
  return relay(await gatewayFetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, oleh }),
  }));
}

export const idAman = (id: string) => (/^\d+$/.test(id) ? id : null);
