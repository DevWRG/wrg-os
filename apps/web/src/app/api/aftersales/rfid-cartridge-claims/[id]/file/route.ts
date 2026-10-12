import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /aftersales/rfid-cartridge-claims/:id/file.
// TIDAK pakai relay() (selalu JSON.parse body) — backend balas bytea mentah +
// content-type/content-disposition, diteruskan apa adanya.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/rfid-cartridge-claims", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    const res = await gatewayFetch(`/aftersales/rfid-cartridge-claims/${encodeURIComponent(id)}/file`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `backend ${res.status}` }));
      return Response.json(data, { status: res.status });
    }
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "attachment",
      },
    });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
