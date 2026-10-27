// F150 — revenue netto per AREA (cabang + region) untuk tab "Revenue Area" di WatchPoint
// (F76) dan menu /profitabilitas-area.
//
// Tahap 2: biaya operasional (6200) per area dari biaya_area_baris (puller
// biaya-area-sync.ts) + laba kotor (revenue netto − HPP; HPP dari product_pricelist_setup,
// hanya baris ber-HPP tak ambigu → `hppCakupanPct`). Biaya 6100/6300 + 6200 yang tak
// tertandai area = baris KANTOR PUSAT (terpisah, hanya untuk akses penuh). Belum ada baris
// biaya → `biayaTersedia=false`, UI menampilkan "—" bukan nol palsu.
//
// Atribusi cabang = cabangEffSql (sama dengan Sales Performance / periodAgg): faktur
// ber-AM → cabang AM pada tanggal faktur; tanpa AM → area lokasi customer. Jangan
// pakai mu.cabang langsung (metric revenue HoD di watchpoint.ts begitu, dan itu
// melewatkan faktur tanpa AM).

import { db } from "../db.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { cabangRegionMap, type Region } from "./sales.js";
import { KANTOR_PUSAT } from "./biaya-area-rules.js";
import { muatBiayaInput, type BiayaInput } from "./biaya-area.js";

export type Periode = "bulan" | "kuartal" | "tahun";
export const PERIODES: readonly Periode[] = ["bulan", "kuartal", "tahun"];

export interface Window {
  from: string;
  to: string;
}

export interface RevenueAreaRow {
  cabang: string;
  region: Region;
  revenue: number;
  revenuePrev: number;
  /** % perubahan vs periode pembanding; null bila pembanding 0. */
  deltaPct: number | null;
  /** % dari total revenue (setelah filter akses). */
  sharePct: number;
  /** Biaya operasional (6200) area ini pada periode berjalan; null bila belum ada data biaya. */
  biaya: number | null;
  /** Laba kotor = revenue netto − HPP, hanya atas revenue ber-HPP tak ambigu (lihat hppCakupanPct). */
  labaKotor: number | null;
  /** % revenue area yang punya HPP tak ambigu; null bila tak ada revenue / data biaya. */
  hppCakupanPct: number | null;
  /** labaKotor − biaya; null bila salah satunya tak tersedia. Parsial bila hppCakupanPct < 100. */
  profit: number | null;
}

export interface KantorPusatRow {
  operasional: number;
  sdm: number;
  luarUsaha: number;
  total: number;
  /** Bagian dari `operasional`: marketing fee tanpa peta INV→customer (belum bisa dialokasi). */
  marketingFeeBelumTerpetakan: number;
}

export interface RevenueAreaResult {
  periode: Periode;
  asOf: string;
  cur: Window;
  prev: Window;
  total: number;
  totalPrev: number;
  deltaPct: number | null;
  regions: { region: Region; revenue: number; revenuePrev: number; deltaPct: number | null }[];
  rows: RevenueAreaRow[];
  biayaTersedia: boolean;
  /** Hanya untuk akses penuh (bukan HoD); null untuk HoD. */
  kantorPusat: KantorPusatRow | null;
  /** % biaya operasional yang sudah bertanda area (wajib tampil, keputusan Direktur). */
  cakupan: BiayaInput["cakupan"] | null;
  terakhirSyncBiaya: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const p2 = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`;

// Geser n bulan; hari di-clamp ke akhir bulan tujuan (31 Mei -3 bln → 28/29 Feb).
export function shiftMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return iso(ny, nm, Math.min(d, last));
}

// Jendela periode berjalan (awal periode → asOf) dan pembandingnya (periode sebelumnya,
// rentang hari sama dari awal periode, di-clamp).
export function windowsFor(periode: Periode, asOf: string): { cur: Window; prev: Window } {
  const [Y, M] = asOf.split("-").map(Number);
  const startMonth = periode === "bulan" ? M : periode === "kuartal" ? Math.floor((M - 1) / 3) * 3 + 1 : 1;
  const span = periode === "bulan" ? 1 : periode === "kuartal" ? 3 : 12;
  const curFrom = iso(Y, startMonth, 1);
  return {
    cur: { from: curFrom, to: asOf },
    prev: { from: shiftMonths(curFrom, -span), to: shiftMonths(asOf, -span) },
  };
}

const pct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const bulat = (n: number) => Math.round(n);

export interface RawRow {
  cabang: string;
  cur: number;
  prev: number;
}

type Body = Pick<RevenueAreaResult, "total" | "totalPrev" | "deltaPct" | "regions" | "rows" | "biayaTersedia" | "kantorPusat" | "cakupan" | "terakhirSyncBiaya">;

// Murni (diuji). `hodCabang` = batasi ke cabang tertentu (akses HoD); null = semua.
export function susunRevenueArea(raw: RawRow[], regionMap: Record<string, Region>, hodCabang: string[] | null, bi?: BiayaInput | null): Body {
  const allow = hodCabang ? new Set(hodCabang) : null;
  // Area yang punya biaya tapi nol revenue periode ini tetap tampil.
  const byCabang = new Map(raw.map((r) => [r.cabang, r] as const));
  if (bi) for (const a of bi.biaya.keys()) if (a !== KANTOR_PUSAT && !byCabang.has(a)) byCabang.set(a, { cabang: a, cur: 0, prev: 0 });
  const rows0 = [...byCabang.values()].filter((r) => !allow || allow.has(r.cabang));
  const total = rows0.reduce((s, r) => s + r.cur, 0);
  const totalPrev = rows0.reduce((s, r) => s + r.prev, 0);
  const biayaTersedia = !!bi && (bi.cakupan.total > 0 || bi.biaya.size > 0);
  const rows: RevenueAreaRow[] = rows0
    .map((r) => {
      const biaya = biayaTersedia ? bulat(bi!.biaya.get(r.cabang) ?? 0) : null;
      const h = bi?.hpp.get(r.cabang);
      const labaKotor = h ? bulat(h.gp) : biayaTersedia ? 0 : null;
      return {
        cabang: r.cabang,
        region: regionMap[r.cabang] ?? ("OFFICE" as Region),
        revenue: r.cur,
        revenuePrev: r.prev,
        deltaPct: pct(r.cur, r.prev),
        sharePct: total > 0 ? Math.round((r.cur / total) * 1000) / 10 : 0,
        biaya,
        labaKotor,
        hppCakupanPct: bi && r.cur > 0 ? Math.round(((h?.revHpp ?? 0) / r.cur) * 1000) / 10 : null,
        profit: biaya != null && labaKotor != null ? labaKotor - biaya : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.cabang.localeCompare(b.cabang));
  const regions = (["East", "West", "OFFICE"] as Region[])
    .map((region) => {
      const rs = rows.filter((r) => r.region === region);
      const revenue = rs.reduce((s, r) => s + r.revenue, 0);
      const revenuePrev = rs.reduce((s, r) => s + r.revenuePrev, 0);
      return { region, revenue, revenuePrev, deltaPct: pct(revenue, revenuePrev) };
    })
    .filter((g) => g.revenue > 0 || g.revenuePrev > 0);
  const kantorPusat: KantorPusatRow | null =
    bi && biayaTersedia && !allow
      ? {
          operasional: bulat(bi.pusat.operasional),
          sdm: bulat(bi.pusat.sdm),
          luarUsaha: bulat(bi.pusat.luarUsaha),
          total: bulat(bi.pusat.operasional + bi.pusat.sdm + bi.pusat.luarUsaha),
          marketingFeeBelumTerpetakan: bulat(bi.pusat.marketingFeeBelumTerpetakan),
        }
      : null;
  return {
    total, totalPrev, deltaPct: pct(total, totalPrev), regions, rows, biayaTersedia, kantorPusat,
    // Cakupan global memuat nominal seluruh perusahaan → tak ditampilkan ke HoD.
    cakupan: bi && biayaTersedia && !allow ? bi.cakupan : null,
    terakhirSyncBiaya: bi?.terakhirSync ?? null,
  };
}

const wibToday = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

/**
 * @param hodKey bila diisi, hanya cabang HoD itu (hod_territory) yang dikembalikan.
 */
export async function getRevenueArea(opts: { periode?: string; asOf?: string; hodKey?: string | null }): Promise<RevenueAreaResult> {
  const periode: Periode = PERIODES.includes(opts.periode as Periode) ? (opts.periode as Periode) : "bulan";
  const asOf = opts.asOf && ISO.test(opts.asOf) ? opts.asOf : wibToday();
  const { cur, prev } = windowsFor(periode, asOf);
  const sql = db();

  const [rows, regionMap, hodRows, bi] = await Promise.all([
    sql`
      SELECT COALESCE(${cabangEffSql(sql)}, 'Tanpa cabang') AS cabang,
             COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)) FILTER (WHERE ai.tanggal BETWEEN ${cur.from} AND ${cur.to}), 0)::numeric AS cur,
             COALESCE(sum(ai.total - COALESCE(ai.tax_amount,0)) FILTER (WHERE ai.tanggal BETWEEN ${prev.from} AND ${prev.to}), 0)::numeric AS prev
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE ai.tanggal BETWEEN ${prev.from} AND ${cur.to}
      GROUP BY 1
    `,
    cabangRegionMap(sql),
    opts.hodKey ? sql<{ cabang: string }[]>`SELECT cabang FROM hod_territory WHERE hod_key = ${opts.hodKey}` : Promise.resolve(null),
    muatBiayaInput(cur),
  ]);

  const raw: RawRow[] = rows.map((r) => ({
    cabang: String((r as Record<string, unknown>).cabang ?? ""),
    cur: Number((r as Record<string, unknown>).cur ?? 0),
    prev: Number((r as Record<string, unknown>).prev ?? 0),
  }));
  const body = susunRevenueArea(raw, regionMap, hodRows ? hodRows.map((h) => h.cabang) : null, bi);
  return { periode, asOf, cur, prev, ...body };
}
