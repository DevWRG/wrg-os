import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { MENU_ATK_KOREKSI } from "@/lib/atk-access";

// Edit & hapus mutasi = koreksi salah catat oleh GA di halaman Stock In (bisa
// mengubah jenis masuk↔keluar), jadi hanya menu Stock In — bukan Stock Out
// (self-service, riwayat read-only) atau Opname (penyesuaian = mutasi baru).

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature(MENU_ATK_KOREKSI, "edit");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const res = await gatewayFetch(`/atk/stock-movements/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return relay(res);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature(MENU_ATK_KOREKSI, "delete");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  const res = await gatewayFetch(`/atk/stock-movements/${encodeURIComponent(id)}`, { method: "DELETE" });
  return relay(res);
}
