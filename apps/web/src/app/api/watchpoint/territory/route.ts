import { requireDirekturOrAdmin, requireHodOrAdmin } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /watchpoint/territory (CRUD mapping HoD→cabang).
export async function GET() {
  const g = await requireHodOrAdmin();
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/watchpoint/territory");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function POST(req: Request) {
  // Peta HoD→cabang menentukan angka WatchPoint per HoD — ubah = Direktur/admin (sama dgn target).
  const g = await requireDirekturOrAdmin();
  if (!g.ok) return g.res;
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  try {
    const res = await gatewayFetch("/watchpoint/territory", {
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
