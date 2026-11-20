import { gatewayFetch } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";
import { requireAdmin } from "@/lib/admin-guard";
import { requireFeature } from "@/lib/feature-guard";
import { picformGate } from "@/lib/picform-access";

export const dynamic = "force-dynamic";

// Gateway → apps/api /picform/* (data 6 form PIC Divisi, migrasi 168/170/171).
// HANYA GET: datanya masuk lewat scripts/ops/pic-form-to-json.py →
// pic-form-import.mjs, tak ada jalur tulis lewat HTTP sama sekali.
//
// Ada supaya tabel langkah SOP (436 baris) & RACI posisi (283 baris) diambil
// per halaman SAAT tab-nya dibuka, bukan ikut terkirim di payload halaman.
export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();
  // Izin per sub-path (lib/picform-access); segmen di luar peta = admin saja.
  const menus = picformGate(sub);
  const g = menus ? await requireFeature(menus) : await requireAdmin();
  if (!g.ok) return g.res;
  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await gatewayFetch(`/picform/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
