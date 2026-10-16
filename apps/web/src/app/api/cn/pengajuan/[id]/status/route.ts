import { canGeserCn, type CnStatus, type TahapCn } from "@/lib/cn-access";
import { actorName } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";
import { idAman, teruskan, tolak } from "../../../_gerbang";

export const dynamic = "force-dynamic";

const STATUS = new Set<string>(["diajukan", "ditinjau", "disetujui", "divalidasi", "terealisasi", "ditolak", "dibatalkan"]);

// Hak per tahap: status & rute pengajuan dibaca SERVER dari api (bukan dari body), lalu dicocokkan dengan
// hod_key / title pelaku di sesi. Urutan status & validasi data tetap di apps/api/src/repo/cn.ts.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return tolak(400, "id tidak valid");
  return teruskan(req, `/cn/pengajuan/${id}/status`, "POST", "edit", async (me, body) => {
    if (typeof body.ke !== "string" || !STATUS.has(body.ke)) return tolak(400, "ke tidak valid");
    let p: TahapCn;
    try {
      const r = await gatewayFetch(`/cn/pengajuan/${id}`);
      if (r.status === 404) return tolak(404, "pengajuan CN tidak ditemukan");
      if (!r.ok) return tolak(502, "backend error");
      p = (await r.json()) as TahapCn;
    } catch {
      return tolak(502, "backend unreachable");
    }
    return canGeserCn(me, p, body.ke as CnStatus, actorName(me)) ? null : tolak(403, `forbidden — Anda tidak memegang tahap "${body.ke}" untuk pengajuan ini`);
  });
}
