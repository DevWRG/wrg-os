import { gatewayFetch, relay } from "@/lib/gateway";

import { gerbang, idAman } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Unggah dokumen kontrak. FormData dibangun ulang (jangan teruskan header
// content-type asli — boundary-nya milik body lama); `oleh` dari SESI.
export async function POST(req: Request, ctx: Ctx) {
  const g = await gerbang("edit");
  if ("tolak" in g) return g.tolak;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file wajib diisi" }, { status: 400 });
  const fd = new FormData();
  fd.set("file", file, file.name);
  fd.set("jenis", String(form.get("jenis") ?? ""));
  fd.set("keterangan", String(form.get("keterangan") ?? ""));
  fd.set("oleh", g.me.name?.trim() || g.me.email || g.me.id);
  try {
    return relay(await gatewayFetch(`/kso-kontrak/${id}/dokumen`, { method: "POST", body: fd }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
