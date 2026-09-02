import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// POST set kategori grup WA (admin only) → apps/api /monitor/groups/category.
// Route spesifik ini menang atas catch-all /api/monitor/[...path] yang TIDAK
// ber-gate admin — jadi tulis kategori tetap admin-only.
export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  const body = await req.json().catch(() => ({}));
  try {
    const res = await gatewayFetch("/monitor/groups/category", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
