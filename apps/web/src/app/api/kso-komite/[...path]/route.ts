// F170 Komite KSO — BFF. Gerbang pertama: sesi + boleh melihat SATU tab Komite KSO (Akses Grup).
// gatewayFetch menyuntik x-service-token yang mem-bypass JWT di apps/api, jadi gerbang ini wajib;
// izin per TAB dan per AKSI diperiksa ulang di apps/api (repo/kso-komite.ts) dari x-user-id SESI.
// Identitas tak pernah diambil dari input browser.
import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewKsoKomite } from "@/lib/kso-komite-access";
import { badSubpath, safeSubpath } from "@/lib/safe-subpath";

type Ctx = { params: Promise<{ path: string[] }> };

async function gerbang() {
  const me = await sessionUser();
  if (!me) return { tolak: Response.json({ error: "unauthenticated" }, { status: 401 }) } as const;
  if (!canViewKsoKomite(me)) return { tolak: Response.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { me } as const;
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gerbang();
  if ("tolak" in g) return g.tolak;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  return relay(await gatewayFetch(`/kso-komite/${sub}`, { headers: { "x-user-id": g.me.id } }));
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await gerbang();
  if ("tolak" in g) return g.tolak;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null || !/^(rencana\/\d+\/[a-z-]+|susunan\/(pemegang|jabatan)|bottom-line\/(keputusan|parameter|biaya|jenis))$/.test(sub)) return badSubpath();
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
