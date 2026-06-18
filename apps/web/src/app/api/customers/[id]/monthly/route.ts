import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /customers/:id/monthly (revenue per bulan satu customer).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const months = new URL(req.url).searchParams.get("months") ?? "12";
  try {
    const res = await gatewayFetch(`/customers/${encodeURIComponent(id)}/monthly?months=${encodeURIComponent(months)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
