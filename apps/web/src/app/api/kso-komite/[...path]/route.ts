// F170 Komite KSO — BFF. Gerbang pertama: sesi + boleh melihat SATU tab Komite KSO (Akses Grup).
// gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api, jadi gerbang ini wajib;
// izin per TAB dan per AKSI diperiksa ulang di apps/api (repo/kso-komite.ts) dari x-user-id SESI.
// Identitas tak pernah diambil dari input browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { TAB_KSO, canTabKso, canViewKsoKomite, type TabKso } from "@/lib/kso-komite-access";
import { badSubpath, safeSubpath } from "@/lib/safe-subpath";

type Ctx = { params: Promise<{ path: string[] }> };

async function gerbang() {
  const me = await sessionUser();
  if (!me) return { tolak: Response.json({ error: "unauthenticated" }, { status: 401 }) } as const;
  if (!canViewKsoKomite(me)) return { tolak: Response.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { me } as const;
}

// 302: berkas PDF lampiran (Simulator KSO CPRR) — satu-satunya GET biner. Pola ketat: tab dikenal +
// id angka, dan tab itu sendiri wajib boleh dilihat sesi ini (bukan cukup "salah satu tab"); API
// memeriksa ulang izin tab + RLS boleh_lihat + path di dalam MEDIA_ROOT.
const POLA_LAMPIRAN = /^([a-z]+)\/rencana\/(\d+)\/lampiran\/(\d+)$/;

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gerbang();
  if ("tolak" in g) return g.tolak;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  const lampiran = sub.match(POLA_LAMPIRAN);
  if (lampiran) return berkasLampiran(g.me, lampiran[1], sub);
  return relay(await gatewayFetch(`/kso-komite/${sub}`, { headers: { "x-user-id": g.me.id } }));
}

async function berkasLampiran(me: NonNullable<Awaited<ReturnType<typeof sessionUser>>>, tab: string, sub: string) {
  if (!TAB_KSO.some((t) => t.tab === tab)) return badSubpath();
  if (!canTabKso(me, tab as TabKso)) return Response.json({ error: "forbidden" }, { status: 403 });
  let res: Response;
  try {
    res = await gatewayFetch(`/kso-komite/${sub}`, { headers: { "x-user-id": me.id } });
  } catch {
    return Response.json({ error: "backend tidak terjangkau" }, { status: 502 });
  }
  // Respons BINER — jangan lewat relay() kecuali galat (relay mengubah body jadi JSON).
  if (!res.ok) return relay(res);
  return new Response(await res.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/pdf",
      "content-disposition": res.headers.get("content-disposition") ?? "inline",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await gerbang();
  if ("tolak" in g) return g.tolak;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null || !/^(rencana\/\d+\/[a-z-]+|susunan\/(pemegang|jabatan)|bottom-line\/(keputusan|parameter|angka|jenis|dukungan|otomatis))$/.test(sub)) return badSubpath();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  return relay(await gatewayFetch(`/kso-komite/${sub}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-user-id": g.me.id },
    body: JSON.stringify(body),
  }));
}
