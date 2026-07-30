import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPricebook, canViewPricebookSummary } from "@/lib/pricebook-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /pricebook/* (F142 Price Book keagenan).
// Dua tingkat gate, sama dengan yang dipakai halaman:
//   items / outside / periode → semua user berizin fitur 'pricebook'
//   summary                   → Direktur/admin/superuser saja
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewPricebook(me)) return Response.json({ error: "forbidden" }, { status: 403 });

  const sub = ((await ctx.params).path ?? []).join("/");
  if (sub === "summary" && !canViewPricebookSummary(me)) {
    return Response.json({ error: "forbidden (Direktur/admin only)" }, { status: 403 });
  }

  const qs = new URL(req.url).searchParams.toString();
  try {
    return relay(await gatewayFetch(`/pricebook/${sub}${qs ? `?${qs}` : ""}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
