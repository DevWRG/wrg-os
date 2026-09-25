import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /export/sales-doc/:id. Respons HTML siap-print
// (tombol "Print/Save as PDF"), bukan JSON — jangan lewat relay().
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/export/sales-doc/${encodeURIComponent(id)}`);
    const html = await res.text();
    return new Response(html, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "text/html; charset=utf-8" },
    });
  } catch {
    return new Response("backend unreachable", { status: 502 });
  }
}
