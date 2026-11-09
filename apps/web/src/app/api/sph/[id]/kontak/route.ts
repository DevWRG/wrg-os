import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sph/:id/kontak (F15): kontak WA customer di Accounts
// sebagai pilihan tujuan kirim. Gerbang EDIT Sales Docs — sama dengan aksi
// kirim; yang tak boleh mengirim tak perlu melihat nomor kontak customer.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    return relay(await gatewayFetch(`/sph/${encodeURIComponent(id)}/kontak`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
