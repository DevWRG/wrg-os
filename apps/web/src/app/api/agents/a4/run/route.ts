import { requireAdmin } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /agents/a4/run (A4 Pipeline Authenticity).
export async function POST() {
  // Menjalankan agen = panggilan LLM berbayar → admin/superuser saja.
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/agents/a4/run", { method: "POST" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
