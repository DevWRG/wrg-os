// Gerbang tulis F169 (riwayat penempatan alat KSO). gatewayFetch menyuntik
// x-service-token yang mem-bypass JWT di apps/api, jadi izin WAJIB diperiksa di
// sini — menyembunyikan tombol di UI tidak menutup endpoint.
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditKsoAlat } from "@/lib/kso-access";

/** Teruskan POST ke apps/api; `oleh` diisi dari SESI, input browser diabaikan. */
export async function teruskanTulis(req: Request, path: string): Promise<Response> {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canEditKsoAlat(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const oleh = me.name?.trim() || me.email || me.id;
  try {
    return relay(await gatewayFetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, oleh }),
    }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
