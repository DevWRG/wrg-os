import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin, sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Aturan siapa boleh mengajukan #OVERTIME — admin saja.
export async function GET() {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/overtime/rules");
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const u = await sessionUser();
  try {
    const res = await gatewayFetch("/overtime/rules", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, created_by: u?.name || u?.email || null }),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
