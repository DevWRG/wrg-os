import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewRaportList } from "@/lib/raport-access";

export const dynamic = "force-dynamic";

// Daftar raport semua karyawan. Gerbangnya HARUS sama dgn halaman /karyawan
// (canViewRaportList → matriks Akses Grup menang, fallback admin/HoD). Dulu di
// sini requireHodOrAdmin: Direktur lolos ke halaman via matriks tapi API-nya
// 403 → halaman "kosong" bertuliskan "Hanya HoD/admin…".
export async function GET(req: Request) {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!canViewRaportList(me)) return Response.json({ error: "forbidden (Akses Grup karyawan)" }, { status: 403 });
  const period = new URL(req.url).searchParams.get("period");
  const qs = period ? `?period=${encodeURIComponent(period)}` : "";
  try {
    return relay(await gatewayFetch(`/raport/list${qs}`, { headers: { "x-user-id": me.id } }));
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
