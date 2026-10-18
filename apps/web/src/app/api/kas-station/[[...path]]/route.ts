import { gatewayFetch, relay } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { sessionUser } from "@/lib/admin-guard";
import { QUERY_DITERUSKAN, bolehSalahSatu, izinUntukRute } from "@/lib/kas-station-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /kas-station/* (F33 Kas Station Reconcile Harian Cabang).
//
// gatewayFetch menyuntik x-service-token yang mem-bypass JWT apps/api, jadi seluruh izin
// ditegakkan di sini: rute harus dikenal (izinUntukRute), dan user harus punya izin yang
// dipetakan untuk method+path itu (station = kunci `kas-station`, pusat = `kas-station-review`).
//
// `actor` SELALU ditimpa dari sesi, bukan diambil dari body/query: kolom itu jejak audit
// "siapa mencatat / mengajukan / menyetujui / merealisasikan". Kalau nilainya dikirim klien,
// jejaknya bisa ditulis atas nama orang lain dan tetap tampak sah.
type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: Request, ctx: Ctx): Promise<Response> {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();

  const method = req.method.toUpperCase();
  const izin = izinUntukRute(method, sub);
  if (!izin) return Response.json({ error: "rute tidak dikenal" }, { status: 404 });
  if (!bolehSalahSatu(me, izin)) return Response.json({ error: "forbidden" }, { status: 403 });

  const actor = me.email ?? me.name ?? me.id;
  let path = `/kas-station/${sub}`;
  const init: RequestInit = { method, headers: { "content-type": "application/json", "x-user-id": me.id } };

  if (method === "GET") {
    const src = new URL(req.url).searchParams;
    const qs = new URLSearchParams();
    for (const k of QUERY_DITERUSKAN) {
      const v = src.get(k);
      if (v !== null) qs.set(k, v);
    }
    if (qs.toString()) path += `?${qs.toString()}`;
  } else if (method === "DELETE") {
    path += `?actor=${encodeURIComponent(actor)}`;
  } else {
    let body: unknown;
    try { body = JSON.parse((await req.text()) || "{}"); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ error: "body harus berupa objek JSON" }, { status: 400 });
    }
    init.body = JSON.stringify({ ...(body as Record<string, unknown>), actor });
  }

  try {
    return relay(await gatewayFetch(path, init));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
