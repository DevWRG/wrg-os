import { gatewayFetch } from "@/lib/gateway";
import { requireDirekturOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api PATCH /approval-requests/config/chain/:urutan (F11).
export async function PATCH(req: Request, { params }: { params: Promise<{ urutan: string }> }) {
  // Mengatur SIAPA approver tiap tahap = kapabilitas keamanan: murni
  // admin/direktur, tak bisa dilonggarkan lewat Akses Grup (pola F60).
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;
  const { urutan } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/approval-requests/config/chain/${encodeURIComponent(urutan)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
