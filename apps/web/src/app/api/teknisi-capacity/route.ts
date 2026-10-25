import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET /teknisi-capacity (F8, dropdown pilih teknisi).
// Baca = boleh lihat salah satu menu Aftersales yang memakai dropdown roster.
// Tambah/nonaktifkan teknisi tak ada lagi di sini sejak migrasi 246 — roster
// ikut master_user role Teknisi (menu Users).
const MENU_PEMAKAI = ["/readiness-board", "/installations", "/maintenance", "/service-tickets"];

export async function GET() {
  const me = await sessionUser();
  if (!me) return Response.json({ error: "unauthenticated" }, { status: 401 });
  if (!MENU_PEMAKAI.some((m) => featureAllowed(me, m, "view"))) {
    return Response.json({ error: "forbidden — tak punya izin menu Aftersales" }, { status: 403 });
  }
  try {
    const res = await gatewayFetch("/teknisi-capacity");
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
