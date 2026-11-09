import { gatewayFetch } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sph/:id/pdf (F15 — SPH resmi A4 berkop). Gerbang:
// lihat Sales Docs. Nama pencetak (footer) dari sesi, bukan dari query klien.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const { id } = await params;
  try {
    const res = await gatewayFetch(
      `/sph/${encodeURIComponent(id)}/pdf?oleh=${encodeURIComponent(actorName(g.me))}`,
    );
    if (!res.ok) {
      const text = await res.text();
      return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
    }
    return new Response(await res.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": res.headers.get("content-disposition") ?? "inline",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
