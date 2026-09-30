import { gatewayFetch } from "@/lib/gateway";
import { requireAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Admin menetapkan HoD sebuah pengajuan yang HoD-nya belum ketahuan, lalu
// notifikasi ke HoD itu dikirim.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin();
  if (!g.ok) return g.res;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { id } = await params;
  try {
    const res = await gatewayFetch(`/overtime/${encodeURIComponent(id)}/assign-hod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
