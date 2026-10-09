import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewOvertime } from "@/lib/overtime-access";

export const dynamic = "force-dynamic";

// Putus pengajuan dari dashboard. Identitas pemutus diambil dari SESI, bukan
// dari body klien; otorisasi akhir (HoD divisi pengaju / admin / direktur)
// ditegakkan di apps/api decideOvertime() — sama dengan jalur balasan WA.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await sessionUser();
  if (!u) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewOvertime(u) && u.is_hod !== true) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { action?: string; note?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { id } = await params;
  const role = (u.role ?? "").trim().toLowerCase();
  const privileged = role === "admin" || role === "direktur" || u.superuser === true;
  try {
    const res = await gatewayFetch(`/overtime/${encodeURIComponent(id)}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: body.action,
        note: body.note,
        actor: { name: u.name || u.email, hodKey: u.hod_key ?? null, privileged },
      }),
    });
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
