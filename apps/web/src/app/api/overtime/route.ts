import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewOvertime } from "@/lib/overtime-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /overtime (#OVERTIME). Pemegang fitur 'overtime' (HR)
// melihat semua pengajuan.
export async function GET(req: Request) {
  const u = await sessionUser();
  if (!u) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewOvertime(u)) return Response.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "from", "to"]) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  try {
    const res = await gatewayFetch(`/overtime${qs.size ? `?${qs}` : ""}`);
    return Response.json(await res.json(), { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
