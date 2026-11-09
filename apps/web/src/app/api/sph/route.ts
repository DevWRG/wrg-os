import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, featureAllowed, requireFeature } from "@/lib/feature-guard";
import { bodyDenganPelaku } from "@/lib/sales-docs-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /sph (daftar SPH + hitungan per status + aksi penonton).
// Gerbang: lihat Sales Docs. x-user-id = sesi; x-bisa-edit = izin edit menu
// Sales Docs menurut matriks — keduanya hanya menentukan PETUNJUK di layar,
// route aksi tetap memeriksa sendiri. Query yang diteruskan dibatasi daftar putih.
export async function GET(req: Request) {
  const g = await requireFeature("/sales-docs", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "q", "limit"]) {
    const v = src.get(k);
    if (v) qs.set(k, v.slice(0, 100));
  }
  try {
    return relay(
      await gatewayFetch(`/sph${qs.size ? `?${qs.toString()}` : ""}`, {
        headers: { "x-user-id": g.me.id, "x-bisa-edit": featureAllowed(g.me, "/sales-docs", "edit") ? "1" : "0" },
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}

// Gateway → apps/api POST /sph (F15 form intake). Gerbang: create menu Sales
// Docs; created_by = pelaku sesi (body diabaikan), x-user-id utk penanda pembuat.
export async function POST(req: Request) {
  const g = await requireFeature("/sales-docs", "create");
  if (!g.ok) return g.res;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    const res = await gatewayFetch("/sph", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": g.me.id },
      body: JSON.stringify(bodyDenganPelaku(body, "created_by", actorName(g.me))),
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
