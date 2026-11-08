import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /export/sales-doc/:id. Respons HTML siap-print
// (tombol "Print/Save as PDF"), bukan JSON — jangan lewat relay().
// Gerbang: lihat Sales Docs — tanpa ini siapa pun yang login bisa membaca isi
// dokumen penjualan (harga, customer) cukup dgn menebak id. SPH punya PDF
// resmi sendiri: /api/sph/:id/pdf.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
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
