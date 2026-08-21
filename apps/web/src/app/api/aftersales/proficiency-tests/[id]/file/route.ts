import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Beda dari BFF route lain (bukan JSON) — teruskan biner sertifikat apa
// adanya, bukan lewat relay() (yg selalu parse body sbg JSON).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/aftersales/proficiency-tests/${encodeURIComponent(id)}/file`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return Response.json({ error: text || `backend ${res.status}` }, { status: res.status });
  }
  const headers = new Headers();
  const contentType = res.headers.get("content-type");
  const contentDisposition = res.headers.get("content-disposition");
  if (contentType) headers.set("content-type", contentType);
  if (contentDisposition) headers.set("content-disposition", contentDisposition);
  return new Response(res.body, { status: 200, headers });
}
