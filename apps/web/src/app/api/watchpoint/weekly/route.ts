import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api /watchpoint/weekly (papan WatchPoint per minggu ISO).
// Query ?year=&week= diteruskan apa adanya; tanpa keduanya = minggu berjalan.
function weekQuery(req: Request): string {
  const src = new URL(req.url).searchParams;
  const out = new URLSearchParams();
  for (const k of ["year", "week"]) {
    const v = src.get(k);
    if (v) out.set(k, v);
  }
  const s = out.toString();
  return s ? `?${s}` : "";
}

export async function GET(req: Request) {
  try {
    return relay(await gatewayFetch(`/watchpoint/weekly${weekQuery(req)}`));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Input manual HoD: satu metric, satu minggu. Aksi tulis → gate HoD/admin di
// layer WEB (konsisten dgn admin-guard.ts; apps/api hanya validasi bentuk data).
export async function PUT(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(
      await gatewayFetch(`/watchpoint/weekly/metric`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Hapus input manual → metric balik ke nilai live/snapshot.
export async function DELETE(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;

  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["year", "week", "hod_key", "metric_key"]) {
    const v = src.get(k);
    if (v) qs.set(k, v);
  }
  try {
    return relay(await gatewayFetch(`/watchpoint/weekly/metric?${qs.toString()}`, { method: "DELETE" }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
