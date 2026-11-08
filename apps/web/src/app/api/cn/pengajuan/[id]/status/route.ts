import { canGeserCn, type CnStatus, type PeranCn, type TahapCn } from "@/lib/cn-access";
import { actorName } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";
import { idAman, teruskan, tolak } from "../../../_gerbang";

export const dynamic = "force-dynamic";

const STATUS = new Set<string>(["diajukan", "ditinjau", "disetujui", "divalidasi", "terealisasi", "ditolak", "dibatalkan"]);

// Hak per tahap: status & rute pengajuan dibaca SERVER dari api (bukan dari body), lalu dicocokkan dengan
// hod_key / grup / title pelaku di sesi. Peran Finance/GA dari master_hod (api /cn/peran); bila gagal dibaca,
// lanjut tanpa itu (grup/title tetap berlaku) — bukan 500. Urutan status & validasi data tetap di apps/api/src/repo/cn.ts.
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
    let peran: PeranCn | undefined;
    try {
      const r = await gatewayFetch("/cn/peran");
      if (r.ok) {
        const j = (await r.json()) as Partial<PeranCn>;
        peran = { finance_hod_keys: j.finance_hod_keys ?? [], ga_hod_keys: j.ga_hod_keys ?? [] };
      }
    } catch {
      peran = undefined;
    }
    return canGeserCn(me, p, body.ke as CnStatus, actorName(me), peran) ? null : tolak(403, `forbidden — Anda tidak memegang tahap "${body.ke}" untuk pengajuan ini`);
  });
}
