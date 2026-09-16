import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /pickup-plan/:id/previsit — pratinjau verifikasi H-1
// (hari libur + PIC utama/backup) TANPA mengirim WA & tanpa menandai apa pun.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/pickup-plan/${encodeURIComponent(id)}/previsit`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
