import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canPublishPricelist } from "@/lib/pricelist-access";

export const dynamic = "force-dynamic";

// POST /api/pricelist/unpublish { ids?: string[] } → tarik published → draft
// (HoD Business / admin). ids kosong → unpublish semua published.
export async function POST(req: Request) {
  const me = await sessionUser();
  if (!canPublishPricelist(me)) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { ids?: string[] };
  try { body = await req.json(); } catch { body = {}; }
  try {
    const res = await gatewayFetch("/pricelist/unpublish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: body.ids }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
