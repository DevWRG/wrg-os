import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { adalahAdmin } from "@/lib/nav";

export const dynamic = "force-dynamic";

// Gateway → apps/api /sph/pengaturan (F15 — penomoran SPH + syarat default).
// GET: siapa pun ber-akses Sales Docs (form /sph/new memakai syarat default).
// PUT: HANYA admin/superuser — nomor surat resmi tak boleh digeser sembarang
// orang. apps/api mengecek ulang dari x-user-id.
export async function GET() {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  try {
    return relay(await gatewayFetch("/sph/pengaturan"));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

export async function PUT(req: Request) {
  const g = await requireFeature("/sales-docs", "edit");
  if (!g.ok) return g.res;
  if (!adalahAdmin(g.me)) return Response.json({ error: "forbidden (admin/superuser only)" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return relay(
      await gatewayFetch("/sph/pengaturan", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-user-id": g.me.id },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
