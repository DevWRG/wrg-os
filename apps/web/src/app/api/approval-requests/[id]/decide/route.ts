import { sessionUser } from "@/lib/admin-guard";
import { gatewayFetch } from "@/lib/gateway";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /approval-requests/:id/decide (F11 kanonik).
//
// Gerbangnya sengaja LOGIN saja, bukan matriks menu: yang berhak memutus
// ditentukan engine per tahap (cekWewenang — HoD/grup/Direktur pemegang
// tahap, bukan pengaju), aturan yang sama dengan #APPROVE WA. Approver modul
// konsumen (mis. Finance di dana ops) belum tentu punya menu Approval, dan
// izin menu tak boleh jadi jalan pintas memutus giliran orang lain.
// Identitas pemutus = akun sesi, tak pernah dari body.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const { id } = await params;
  let body: { action?: unknown; note?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.action !== "approve" && body.action !== "reject") {
    return Response.json({ error: "action harus approve|reject" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch(`/approval-requests/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: body.action,
        note: typeof body.note === "string" ? body.note : null,
        user_id: me.id,
      }),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
