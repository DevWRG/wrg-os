import { gatewayFetch } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /installations/options (daftar cabang + cabang wilayah
// customer terpilih) — pengisi dropdown Cabang di form Instalasi.
export async function GET(req: Request) {
  const guard = await requireFeature("/installations", "view");
  if (!guard.ok) return guard.res;
  const acc = new URL(req.url).searchParams.get("account_id");
  const qs = acc && /^\d+$/.test(acc) ? `?account_id=${acc}` : "";
  try {
    const res = await gatewayFetch(`/installations/options${qs}`);
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
