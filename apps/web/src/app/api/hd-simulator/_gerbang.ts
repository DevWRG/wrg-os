// Gerbang bersama route BFF Simulator HD (/hd-simulator) — menu & kunci izin sendiri
// ('hd-simulator'), terpisah dari tracker Proyek HD. gatewayFetch menyuntik x-service-token
// yang mem-bypass JWT di apps/api, jadi izin WAJIB dicek di sini. Apa pun yang memuat harga,
// biaya, atau margin WRG hanya dilayani ke pemegang 'proyek-hd-margin'.
import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature, type GuardResult } from "@/lib/feature-guard";
import type { Action } from "@/lib/perms";

export const gerbang = (aksi: Action): Promise<GuardResult> => requireFeature("/hd-simulator", aksi);
export const idAman = (id: string) => (/^\d{1,12}$/.test(id) ? id : null);
export const putus = () => Response.json({ error: "backend unreachable" }, { status: 502 });

export async function bacaJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const t = await req.text();
    const v = t ? JSON.parse(t) : {};
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

export { actorName, gatewayFetch, relay };
