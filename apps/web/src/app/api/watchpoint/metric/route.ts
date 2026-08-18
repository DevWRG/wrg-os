import { gatewayFetch, relay } from "@/lib/gateway";
import { requireDirekturOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /watchpoint/metric (target & nilai manual papan "sekarang").
// Aksi tulis di-gate di layer WEB seperti route WatchPoint lain; apps/api hanya
// memvalidasi bentuk data. Target = kesepakatan Direktur–HoD → direktur/admin.

export async function PUT(req: Request) {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // Jejak audit ringan: pengubah diambil dari sesi, bukan dari body klien.
  const payload = { ...body, updated_by: guard.me.email };
  try {
    return relay(
      await gatewayFetch(`/watchpoint/metric`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  const guard = await requireDirekturOrAdmin();
  if (!guard.ok) return guard.res;

  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["hod_key", "metric_key"]) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }
  try {
    return relay(await gatewayFetch(`/watchpoint/metric?${qs.toString()}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
