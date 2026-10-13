import { gatewayFetch, relay } from "@/lib/gateway";
import { requireFeature } from "@/lib/feature-guard";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";

export const dynamic = "force-dynamic";

// BFF F58 Adopsi Fitur → apps/api /adoption/*. HANYA baca: summary + training-needs.
// Pencatatan event (/adoption/event) sengaja TIDAK dibuka ke browser — event hanya boleh
// dikirim server (adoption-record.ts) dengan identitas dari sesi. Identitas ke api = x-user-id
// dari sesi; audiens (semua / tim HoD / ditolak) ditegakkan apps/api.
const ALLOWED = new Set(["summary", "training-needs"]);
const FORWARD = ["period", "month", "feature", "title", "q", "limit"];

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const g = await requireFeature("/adoption", "view");
  if (!g.ok) return g.res;
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  if (!ALLOWED.has(sub)) return Response.json({ error: "endpoint tidak ditemukan" }, { status: 404 });
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  for (const k of FORWARD) { const v = src.get(k); if (v) qs.set(k, v); }
  try {
    return relay(await gatewayFetch(`/adoption/${sub}${qs.size ? `?${qs}` : ""}`, { headers: { "x-user-id": g.me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
