import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /watchpoint/weekly/:hod/send-wa
// (ringkasan WatchPoint MINGGUAN 1 HoD via WA; patuh WA_DRY_RUN di backend).
export async function POST(req: Request, ctx: { params: Promise<{ hod: string }> }) {
  const { hod } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(
      await gatewayFetch(`/watchpoint/weekly/${encodeURIComponent(hod)}/send-wa`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
