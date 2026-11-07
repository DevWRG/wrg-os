import { requireDirekturOrAdmin } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /approval-requests/config/alur/:jenis (SLA alur).
// Sama dengan config tahap: murni admin/direktur (pola F60).
export async function PATCH(req: Request, { params }: { params: Promise<{ jenis: string }> }) {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;
  const { jenis } = await params;
  let body: { slaJam?: unknown; eskalasi?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/approval-requests/config/alur/${encodeURIComponent(jenis)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slaJam: body.slaJam, eskalasi: body.eskalasi }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
