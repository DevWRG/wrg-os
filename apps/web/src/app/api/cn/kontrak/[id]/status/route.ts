import { canKelolaKontrakCn } from "@/lib/cn-access";
import { idAman, teruskan, tolak } from "../../../_gerbang";

export const dynamic = "force-dynamic";

// Aktivasi/pembatalan kontrak = Direktur (+ admin/superuser).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = idAman((await ctx.params).id);
  if (!id) return tolak(400, "id tidak valid");
  return teruskan(req, `/cn/kontrak/${id}/status`, "POST", "edit", (me) =>
    canKelolaKontrakCn(me) ? null : tolak(403, "forbidden — hanya Direktur yang mengaktifkan/membatalkan kontrak CN"));
}
