import { gatewayFetch, relay } from "@/lib/gateway";
import { requireHodOrAdmin } from "@/lib/admin-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api POST /watchpoint/weekly/snapshot (bekukan minggu).
// Aksi tulis lintas-HoD → dibatasi HoD/admin di layer WEB (pola admin-guard).
export async function POST(req: Request) {
  const guard = await requireHodOrAdmin();
  if (!guard.ok) return guard.res;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* body opsional → backend pakai minggu berjalan */
  }
  try {
    return relay(
      await gatewayFetch(`/watchpoint/weekly/snapshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
