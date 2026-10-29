import { idAman, teruskan, tolak } from "../../_gerbang";

export const dynamic = "force-dynamic";

// Aksi tulis DOC (izin edit). Pelaku dari sesi (lihat _gerbang.ts); urutan/validasi di apps/api.
export async function POST(req: Request, ctx: { params: Promise<{ soId: string }> }) {
  const id = idAman((await ctx.params).soId);
  if (!id) return tolak(400, "id SO tidak valid");
  return teruskan(req, `/doc-tracker/${id}/dokumen`, "POST", "edit");
}
