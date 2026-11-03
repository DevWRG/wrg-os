import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /deals/:id/notes (F174 catatan follow-up tanpa pindah
// tahap). Identitas lewat x-user-id → write-guard backend sama dengan transisi
// stage (AM deal sendiri, HoD cabang, admin semua). Body: { note: string }.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await ctx.params;
  const body = await req.text();
  try {
    const res = await gatewayFetch(`/deals/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      headers: { "x-user-id": me.id, "content-type": "application/json" },
      body,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
