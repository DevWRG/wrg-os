import { gatewayFetch, relay } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed, requireFeature } from "@/lib/feature-guard";

export const dynamic = "force-dynamic";

// Gateway → apps/api GET/POST /teknisi-capacity (F8, dipakai dropdown pilih teknisi + CRUD roster).
// Dulu TANPA gerbang (cuma login): siapa pun bisa menambah/mengubah teknisi
// termasuk nomor WA — tujuan WA tiket servis & pengingat PM (temuan 13 Okt 2026).
// Baca = boleh lihat salah satu menu Aftersales yang memakai dropdown roster;
// tulis = izin Readiness Board (tempat roster dikelola).
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

export async function POST(req: Request) {
  const guard = await requireFeature("/readiness-board", "create");
  if (!guard.ok) return guard.res;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  try {
    return await relay(
      await gatewayFetch("/teknisi-capacity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch {
    return Response.json({ error: "backend unreachable" }, { status: 502 });
  }
}
