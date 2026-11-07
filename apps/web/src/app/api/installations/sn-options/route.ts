import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /installations/sn-options (saran SN dari Populasi Alat
// untuk alat terpilih) — pengisi daftar SN di form Instalasi.
export async function GET(req: Request) {
  const guard = await requireFeature("/installations", "view");
  if (!guard.ok) return guard.res;
  const pid = new URL(req.url).searchParams.get("product_id");
  if (!pid || !/^\d+$/.test(pid)) return Response.json({ error: "product_id wajib angka" }, { status: 400 });
  try {
    const res = await gatewayFetch(`/installations/sn-options?product_id=${pid}`);
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
