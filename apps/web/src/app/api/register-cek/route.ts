import { gatewayFetch, relay } from "@/lib/gateway";
import { actorName, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// F10 Register Cek. gatewayFetch menyuntik service token yang mem-bypass JWT di apps/api,
// jadi izin menu WAJIB dicek di sini. `oleh` selalu dari sesi, tak pernah dari body.
export async function GET(req: Request) {
  const g = await requireFeature("/register-cek", "view");
  if (!g.ok) return g.res;
  const src = new URL(req.url).searchParams;
  const qs = new URLSearchParams();
  const status = src.get("status");
  const hari = src.get("hari");
  if (status === "aktif") qs.set("status", status);
  if (hari && /^\d{1,4}$/.test(hari)) qs.set("hari", hari);
  try { return relay(await gatewayFetch(`/cek-keluar${qs.size ? `?${qs}` : ""}`)); }
  catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}

// Input cek baru (draft, atau langsung diajukan) — izin TAMBAH.
export async function POST(req: Request) {
  const g = await requireFeature("/register-cek", "create");
  if (!g.ok) return g.res;
  const b = ((await req.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  try {
    return relay(await gatewayFetch("/cek-keluar", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...b, oleh: actorName(g.me) }),
    }));
  } catch { return Response.json({ error: "backend unreachable" }, { status: 502 }); }
}
