import { canAturParamHd, canLihatMarginHd } from "@/lib/proyek-hd-access";
import { actorName, bacaJson, gatewayFetch, gerbang, putus, relay } from "../_gerbang";

export const dynamic = "force-dynamic";

const kunciMargin = (k: string) => k.startsWith("margin_");
// Simulator hanya butuh kunci rs_* dan margin_*; parameter tracker tetap di menu Proyek HD.
const kunciSimulator = (k: string) => k.startsWith("rs_") || kunciMargin(k);

export async function GET() {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  try {
    const res = await gatewayFetch("/proyek-hd/param");
    if (!res.ok) return relay(res);
    const d = (await res.json()) as { items: { kunci: string }[] };
    const margin = canLihatMarginHd(g.me);
    return Response.json({
      items: d.items.filter((p) => kunciSimulator(p.kunci) && (margin || !kunciMargin(p.kunci))),
      boleh_ubah: canAturParamHd(g.me),
    });
  } catch { return putus(); }
}

export async function PATCH(req: Request) {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  if (!canAturParamHd(g.me)) return Response.json({ error: "forbidden — parameter hanya diatur admin atau pemegang Margin WRG" }, { status: 403 });
  const body = await bacaJson(req);
  const nilai = body?.nilai;
  if (!nilai || typeof nilai !== "object") return Response.json({ error: "nilai wajib berupa objek" }, { status: 400 });
  const kunci = Object.keys(nilai);
  if (kunci.some((k) => !kunciSimulator(k))) return Response.json({ error: "hanya parameter simulator yang bisa diubah di sini" }, { status: 400 });
  if (kunci.some(kunciMargin) && !canLihatMarginHd(g.me)) {
    return Response.json({ error: "forbidden — parameter margin hanya untuk pemegang Margin WRG" }, { status: 403 });
  }
  try {
    return relay(await gatewayFetch("/proyek-hd/param", {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nilai, oleh: actorName(g.me) }),
    }));
  } catch { return putus(); }
}
