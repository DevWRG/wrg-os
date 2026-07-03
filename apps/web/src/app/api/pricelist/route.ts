import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricelist, canEditPricelistSetup } from "@/lib/pricelist-access";

export const dynamic = "force-dynamic";

// GET /api/pricelist?status=published|draft → apps/api GET /pricelist.
// status 'published' butuh akses AM; status lain (draft/semua) butuh akses setup.
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status");
  const me = await sessionUser();
  const allowed = status === "published" ? canViewPricelist(me) : canEditPricelistSetup(me);
  if (!allowed) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const res = await gatewayFetch(`/pricelist${qs}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// POST /api/pricelist → upsert satu baris (HoD Business / Purchasing / admin).
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!canEditPricelistSetup(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid JSON body" }, { status: 400 }); }
  try {
    const res = await gatewayFetch("/pricelist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, created_by: me?.email ?? null }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// DELETE /api/pricelist?id=<uuid> → hapus baris (HoD Business / Purchasing / admin).
export async function DELETE(req: Request) {
  const me = await sessionUser();
  if (!canEditPricelistSetup(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id wajib" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/pricelist/${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
