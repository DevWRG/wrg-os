import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { gatewayFetch } from "@/lib/gateway";
import { safeSubpath, badSubpath } from "@/lib/safe-subpath";

export const dynamic = "force-dynamic";

// Gateway → apps/api /stock/* (F37/F38). Read-only: data stok per gudang & batch
// masuk lewat importer/puller, bukan lewat HTTP — jadi proxy ini sengaja hanya
// meneruskan GET.
//
// Ada supaya halaman bisa mengambil datanya SAAT DIBUKA / ganti filter, bukan ikut
// terkirim di payload halaman (~1,3 MB matriks pada katalog 5.800 item).
//
// Gerbang izin per segmen pertama (pola #1575/#1585): tanpa ini user login mana
// pun — termasuk yang tak punya grup — bisa membaca stok seluruh gudang lewat
// curl walau menunya tertutup. `warehouses` hanya master gudang cabang dan
// dipakai kedua menu, jadi cukup salah satu izin.
const MENU_PER_SEGMEN: Record<string, string[]> = {
  branch: ["/stok-gudang"],
  batch: ["/ed-watch"],
  warehouses: ["/stok-gudang", "/ed-watch"],
};

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const sub = safeSubpath((await ctx.params).path);
  if (sub === null) return badSubpath();

  const menu = MENU_PER_SEGMEN[sub.split("/")[0] ?? ""];
  // Segmen tak dikenal = tertutup, bukan diteruskan apa adanya.
  if (!menu) return Response.json({ error: "path tidak dikenal" }, { status: 404 });
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!menu.some((m) => featureAllowed(me, m, "view"))) {
    return Response.json({ error: "forbidden — tak punya izin view untuk menu ini" }, { status: 403 });
  }

  const qs = new URL(req.url).searchParams.toString();
  try {
    const res = await gatewayFetch(`/stock/${sub}${qs ? `?${qs}` : ""}`);
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
