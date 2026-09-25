import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /ga-assets/:id/upload (F132, multipart foto/dokumen).
// Baca FormData lalu susun ulang (bukan teruskan body mentah) — fetch akan
// set boundary multipart baru sendiri sesuai FormData ini, JANGAN salin
// header content-type dari request asli (boundary-nya sudah tidak cocok).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return Response.json({ error: "invalid multipart body" }, { status: 400 });
  }
  const fd = new FormData();
  const kind = incoming.get("kind");
  const file = incoming.get("file");
  if (typeof kind === "string") fd.set("kind", kind);
  if (file instanceof File) fd.set("file", file);
  try {
    return await relay(
      await gatewayFetch(`/ga-assets/${encodeURIComponent(id)}/upload`, { method: "POST", body: fd }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
