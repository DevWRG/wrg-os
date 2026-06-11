import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway catch-all → apps/api GET /report/* (summary, per-orang, per-hod,
// daily-trend, drilldown, reminders-pending, range-default). Query diteruskan.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/report/${path.join("/")}${search}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
