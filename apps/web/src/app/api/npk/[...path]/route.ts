import { gatewayFetch } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { requireFeature } from "@/lib/feature-guard";
import { npkGate } from "@/lib/npk-api-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /npk/*. Meneruskan identitas user via header x-user-id agar
// backend menerapkan row-level scope NPK (admin → semua HoD; HoD → diri sendiri).
// Izin menu per sub-path di lib/npk-api-access; semua endpoint backend sudah
// terpetakan, jadi segmen di luar peta ditolak.
async function proxy(req: Request, path: string[], method: "GET" | "POST") {
  const sub = safeSubpath(path);
  if (sub === null) return badSubpath();
  const m = npkGate(sub, method);
  if (!m) return Response.json({ error: "forbidden — sub-path NPK tak dikenal" }, { status: 403 });
  const g = await requireFeature(m.menus, m.action);
  if (!g.ok) return g.res;
  const me = g.me;
  const { searchParams } = new URL(req.url);
  const qs = searchParams.toString();
  const headers: Record<string, string> = { "x-user-id": me.id };
  let body: string | undefined;
  if (method === "POST") {
    headers["content-type"] = "application/json";
    body = await req.text();
  }
  try {
    const res = await gatewayFetch(`/npk/${sub}${qs ? `?${qs}` : ""}`, { method, headers, body });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "GET");
}
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxy(req, (await ctx.params).path, "POST");
}
