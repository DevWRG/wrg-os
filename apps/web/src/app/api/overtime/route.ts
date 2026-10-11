import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { overtimeScope } from "@/lib/overtime-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /overtime (#OVERTIME). Scope baris dari SESI: HoD
// dipaksa ke hod_key-nya sendiri (param hod_key dari klien diabaikan), HR /
// admin / direktur melihat semua.
export async function GET(req: Request) {
  const u = await sessionUser();
  if (!u) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const scope = overtimeScope(u);
  if (!scope) return Response.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of ["status", "from", "to", "limit", "offset"]) {
    const v = sp.get(k);
    if (v) qs.set(k, v);
  }
  if (!scope.all) qs.set("hod_key", scope.hodKey);
  try {
    const res = await gatewayFetch(`/overtime${qs.size ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(res.ok ? { ...data, scope: scope.all ? "all" : "hod" } : data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
