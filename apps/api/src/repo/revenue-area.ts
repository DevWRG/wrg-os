// F150 (tahap 1) — revenue netto per AREA (cabang + region) untuk tab "Revenue Area"
// di WatchPoint (F76) dan menu /profitabilitas-area.
//
// Sisi BIAYA belum ada: mirror Accurate tak punya beban/jurnal (lihat
// BRIEF-F150-DATA-BIAYA-ACCURATE.md). Karena itu `biaya` & `profit` selalu null dan
// `biayaTersedia=false` — UI menampilkan "menunggu data Accurate", bukan nol palsu.
//
// Atribusi cabang = cabangEffSql (sama dengan Sales Performance / periodAgg): faktur
// ber-AM → cabang AM pada tanggal faktur; tanpa AM → area lokasi customer. Jangan
// pakai mu.cabang langsung (metric revenue HoD di watchpoint.ts begitu, dan itu
// melewatkan faktur tanpa AM).

import { db } from "../db.js";
import { cabangEffSql, joinAmFromSalesman } from "./salesman-am.js";
import { cabangRegionMap, type Region } from "./sales.js";

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
  biaya: null;
  profit: null;
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
  biayaTersedia: false;
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

export interface RawRow {
  cabang: string;
  cur: number;
  prev: number;
}

// Murni (diuji). `hodCabang` = batasi ke cabang tertentu (akses HoD); null = semua.
export function susunRevenueArea(
  raw: RawRow[],
  regionMap: Record<string, Region>,
  hodCabang: string[] | null,
): Pick<RevenueAreaResult, "total" | "totalPrev" | "deltaPct" | "regions" | "rows"> {
  const allow = hodCabang ? new Set(hodCabang) : null;
  const rows0 = raw.filter((r) => !allow || allow.has(r.cabang));
  const total = rows0.reduce((s, r) => s + r.cur, 0);
  const totalPrev = rows0.reduce((s, r) => s + r.prev, 0);
  const rows: RevenueAreaRow[] = rows0
    .map((r) => ({
      cabang: r.cabang,
      region: regionMap[r.cabang] ?? ("OFFICE" as Region),
      revenue: r.cur,
      revenuePrev: r.prev,
      deltaPct: pct(r.cur, r.prev),
      sharePct: total > 0 ? Math.round((r.cur / total) * 1000) / 10 : 0,
      biaya: null,
      profit: null,
    }))
    .sort((a, b) => b.revenue - a.revenue || a.cabang.localeCompare(b.cabang));
  const regions = (["East", "West", "OFFICE"] as Region[])
    .map((region) => {
      const rs = rows.filter((r) => r.region === region);
      const revenue = rs.reduce((s, r) => s + r.revenue, 0);
      const revenuePrev = rs.reduce((s, r) => s + r.revenuePrev, 0);
      return { region, revenue, revenuePrev, deltaPct: pct(revenue, revenuePrev) };
    })
    .filter((g) => g.revenue > 0 || g.revenuePrev > 0);
  return { total, totalPrev, deltaPct: pct(total, totalPrev), regions, rows };
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

  const [rows, regionMap, hodRows] = await Promise.all([
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
  ]);

  const raw: RawRow[] = rows.map((r) => ({
    cabang: String((r as Record<string, unknown>).cabang ?? ""),
    cur: Number((r as Record<string, unknown>).cur ?? 0),
    prev: Number((r as Record<string, unknown>).prev ?? 0),
  }));
  const body = susunRevenueArea(raw, regionMap, hodRows ? hodRows.map((h) => h.cabang) : null);
  return { periode, asOf, cur, prev, ...body, biayaTersedia: false };
}
