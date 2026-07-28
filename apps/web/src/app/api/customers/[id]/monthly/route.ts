import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /customers/:id/monthly (revenue per bulan satu customer).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const months = new URL(req.url).searchParams.get("months") ?? "12";
  const me = await sessionUser();
  try {
    const res = await gatewayFetch(`/customers/${encodeURIComponent(id)}/monthly?months=${encodeURIComponent(months)}`, me ? { headers: { "x-user-id": me.id } } : undefined);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
