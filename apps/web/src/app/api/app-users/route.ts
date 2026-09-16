import { gatewayFetch, relay } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /app-users — picker ringan (id+name+active) utk
// F133 Assign/Transfer, BUKAN admin-only (beda dari /api/admin/users).
export async function GET(req: Request) {
  const qs = new URL(req.url).search;
  try {
    return await relay(await gatewayFetch(`/app-users${qs}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
