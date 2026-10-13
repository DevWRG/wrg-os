// Gerbang BFF F169 (riwayat penempatan alat KSO, menu Daftar Alat).
// gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api, jadi
// izin WAJIB diperiksa di sini — menyembunyikan tombol di UI tidak menutup endpoint.
//   baca  : siapa pun yang boleh membuka Daftar Alat (kso-simulator ATAU teknisi)
//   tulis : HANYA 'kso-mutasi-alat' tingkat edit (teknisi; keputusan user 13 Okt)
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canBukaDaftarAlat, canMutasiAlatKso } from "@/lib/kso-access";

export async function teruskanBaca(path: string): Promise<Response> {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canBukaDaftarAlat(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return relay(await gatewayFetch(path));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

/** Teruskan POST ke apps/api; `oleh` diisi dari SESI, input browser diabaikan. */
export async function teruskanTulis(req: Request, path: string): Promise<Response> {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canMutasiAlatKso(me)) return Response.json({ error: "forbidden" }, { status: 403 });
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
