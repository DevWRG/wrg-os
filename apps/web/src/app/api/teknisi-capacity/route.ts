import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /teknisi-capacity (F8, dipakai dropdown pilih teknisi).
export async function GET() {
  try {
    const res = await gatewayFetch("/teknisi-capacity");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
