import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ar/invoice/:no (detail satu invoice + line item).
// x-user-id → row-level scope: invoice di luar scope balas 404 dari backend.
export async function GET(_req: Request, { params }: { params: Promise<{ no: string }> }) {
  const [{ no }, me] = await Promise.all([params, sessionUser()]);
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const res = await gatewayFetch(`/ar/invoice/${encodeURIComponent(no)}`, { headers: { "x-user-id": me.id } });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
