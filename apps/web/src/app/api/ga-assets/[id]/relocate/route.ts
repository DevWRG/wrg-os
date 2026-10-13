import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ga-assets/:id/relocate (multipart, berita acara wajib).
// Gerbang = izin create menu Relokasi Aset; pelaku dari SESI, bukan body.
// FormData disusun ulang (bukan diteruskan mentah) supaya boundary multipart
// dibuat fetch sendiri dan field identitas dari klien tak ikut terbawa.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/ga-relokasi", "create");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const fd = new FormData();
  for (const k of ["to_location", "keep_pic", "to_user_id", "to_pic_name", "relocation_date", "reason"]) {
    const v = incoming.get(k);
    if (typeof v === "string") fd.set(k, v);
  }
  const file = incoming.get("file");
  if (file instanceof File) fd.set("file", file);
  fd.set("created_by", guard.me.id);
  fd.set("created_by_name", actorName(guard.me));
  try {
    return await relay(await gatewayFetch(`/ga-assets/${encodeURIComponent(id)}/relocate`, { method: "POST", body: fd }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
