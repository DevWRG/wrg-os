import { featureAllowed } from "@/lib/feature-guard";
import { actorName, bacaJson, gatewayFetch, gerbang, putus, relay } from "../_gerbang";

export const dynamic = "force-dynamic";

// Pengaturan tracker Proyek HD — hanya kunci yang benar-benar dipakai dashboard:
// tarif per tindakan (KPI Proyeksi omset) dan target rasio running : idle. Parameter
// simulator (rs_* / margin_*) diatur dari menu Simulator KSO HD (/api/hd-simulator/param).
const KUNCI_TRACKER = ["tarif_per_tindakan", "target_rasio_running_idle"];

export async function GET() {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/proyek-hd/param");
    if (!res.ok) return relay(res);
    const d = (await res.json()) as { items: { kunci: string }[] };
    const boleh = g.me.role === "admin" || g.me.superuser === true || featureAllowed(g.me, "/proyek-hd", "edit");
    return Response.json({ items: d.items.filter((p) => KUNCI_TRACKER.includes(p.kunci)), boleh_ubah: boleh });
  } catch { return putus(); }
}

export async function PATCH(req: Request) {
  const g = await gerbang("edit");
  if (!g.ok) return g.res;
  const body = await bacaJson(req);
  const nilai = body?.nilai;
  if (!nilai || typeof nilai !== "object") return Response.json({ error: "nilai wajib berupa objek" }, { status: 400 });
  if (Object.keys(nilai).some((k) => !KUNCI_TRACKER.includes(k))) {
    return Response.json({ error: "hanya pengaturan tracker yang bisa diubah di sini — parameter simulator ada di menu Simulator KSO HD" }, { status: 400 });
  }
  try {
    return relay(await gatewayFetch("/proyek-hd/param", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nilai, oleh: actorName(g.me) }),
    }));
  } catch { return putus(); }
}
