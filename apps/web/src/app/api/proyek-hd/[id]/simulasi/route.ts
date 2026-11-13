import { canLihatMarginHd } from "@/lib/proyek-hd-access";
import { KUNCI_MARGIN, ringkasMargin, ringkasProyeksi, type MarginInput, type ProyeksiInput } from "@/lib/proyek-hd/simulator";
import { actorName, bacaJson, gatewayFetch, gerbang, idAman, putus, relay } from "../../_gerbang";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Simulasi margin_wrg (biaya & margin WRG) hanya dibaca/disimpan pemegang 'proyek-hd-margin'.
export async function GET(_req: Request, ctx: Ctx) {
  const g = await gerbang("view");
  if (!g.ok) return g.res;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  const jenis = canLihatMarginHd(g.me) ? "proyeksi_rs,margin_wrg" : "proyeksi_rs";
  try { return relay(await gatewayFetch(`/proyek-hd/${id}/simulasi?jenis=${jenis}`)); } catch { return putus(); }
}

const angka = (o: Record<string, unknown>, kunci: readonly string[]) =>
  Object.fromEntries(kunci.map((k) => [k, Number(o[k])]));

export async function POST(req: Request, ctx: Ctx) {
  const g = await gerbang("edit");
  if (!g.ok) return g.res;
  const id = idAman((await ctx.params).id);
  if (!id) return Response.json({ error: "id tidak valid" }, { status: 400 });
  const b = await bacaJson(req);
  const input = b?.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : null;
  if (!b || !input) return Response.json({ error: "input simulasi wajib diisi" }, { status: 400 });
  let ringkasan: string;
  if (b.jenis === "margin_wrg") {
    if (!canLihatMarginHd(g.me)) return Response.json({ error: "forbidden — simulasi margin hanya untuk pemegang Margin WRG" }, { status: 403 });
    ringkasan = ringkasMargin(angka(input, KUNCI_MARGIN) as unknown as MarginInput);
  } else if (b.jenis === "proyeksi_rs") {
    const p = { ...angka(input, ["mesin", "shift", "hari", "tarif_klaim", "porsi_pct", "harga_tetap"]), mode: input.mode } as unknown as ProyeksiInput;
    ringkasan = ringkasProyeksi(p);
  } else {
    return Response.json({ error: "jenis simulasi tidak dikenal" }, { status: 400 });
  }
  try {
    return relay(await gatewayFetch(`/proyek-hd/${id}/simulasi`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jenis: b.jenis, label: b.label, input, ringkasan, oleh: actorName(g.me) }),
    }));
  } catch { return putus(); }
}
