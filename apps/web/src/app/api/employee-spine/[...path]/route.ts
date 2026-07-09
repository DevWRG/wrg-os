import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api /employee-spine/* (read-only). BFF tepercaya via service-token.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = (path ?? []).join("/");
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  try {
    const res = await gatewayFetch(`/employee-spine/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
