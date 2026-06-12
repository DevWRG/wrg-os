import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway catch-all → apps/api GET /monitor/* (members, rekap, resume, …). Query diteruskan.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const search = new URL(req.url).search;
  try {
    const res = await gatewayFetch(`/monitor/${path.join("/")}${search}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// POST → apps/api POST /monitor/* (mis. rekap/generate, resume/generate, digests).
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* body opsional */
  }
  try {
    const res = await gatewayFetch(`/monitor/${path.join("/")}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
