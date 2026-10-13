import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /asset-tags/:id/audit (riwayat verifikasi fisik, F53).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/asset-tag", "view");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  try {
    return await relay(await gatewayFetch(`/asset-tags/${encodeURIComponent(id)}/audit`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireFeature("/asset-tag", "create");
  if (!guard.ok) return guard.res;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch(`/asset-tags/${encodeURIComponent(id)}/audit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
