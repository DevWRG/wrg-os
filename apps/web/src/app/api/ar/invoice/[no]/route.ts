import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /ar/invoice/:no (detail satu invoice + line item).
export async function GET(_req: Request, { params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  try {
    const res = await gatewayFetch(`/ar/invoice/${encodeURIComponent(no)}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
