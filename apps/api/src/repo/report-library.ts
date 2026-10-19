// F92 — Report Library: 6 laporan eksekutif dalam satu menu, tiap laporan bisa diunduh PDF.
//
// Tak ada query baru di sini. Setiap laporan memanggil fungsi repo yang SAMA dengan
// endpoint halaman sumbernya (WatchPoint, Pipeline, AR, Stok Gudang, Product Scorecard,
// Customers/Churn) dengan scope user yang sama, lalu meratakan hasilnya jadi
// {ringkasan, header, baris} bertipe string. Jadi angka di PDF tak bisa berbeda dari
// yang tampil di halaman sumber, dan AM tak bisa melihat data AM lain lewat menu ini.
//
// Product Performance sengaja TANPA kolom margin (gp/gp_pct): margin dijaga
// canViewMargin di web, dan laporan ini dibagikan lebih luas dari itu.

import { arAgingByCustomer } from "./ar.js";
import type { DataScope } from "./access-scope.js";
import { getPipeline } from "./deal.js";
import { productScorecard } from "./product-scorecard.js";
import { churnCustomers } from "./sales.js";
import { stockBranchSummary } from "./stock-branch.js";
import { getWatchBoard } from "./watchpoint.js";

export const KEY_LAPORAN = ["kpi-hod", "pipeline", "ar-aging", "stok", "produk", "churn"] as const;
export type KeyLaporan = (typeof KEY_LAPORAN)[number];

export const adalahKeyLaporan = (k: string): k is KeyLaporan => (KEY_LAPORAN as readonly string[]).includes(k);

/** Baris yang ditampilkan di layar (PDF memuat semua baris). */
export const BARIS_PRATINJAU = 10;

export interface Laporan {
  key: KeyLaporan;
  judul: string;
  ringkasan: { label: string; nilai: string }[];
  header: string[];
  baris: string[][];
}

// ── Pemformat murni (dites) ──────────────────────────────────────

const ID = "id-ID";

export const rp = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "-" : `Rp ${Math.round(Number(n)).toLocaleString(ID)}`;

export const angka = (n: number | null | undefined, desimal = 0): string =>
  n === null || n === undefined || !Number.isFinite(Number(n))
    ? "-"
    : Number(n).toLocaleString(ID, { maximumFractionDigits: desimal });

export const persen = (n: number | null | undefined, desimal = 1): string =>
  n === null || n === undefined || !Number.isFinite(Number(n)) ? "-" : `${Number(n).toLocaleString(ID, { maximumFractionDigits: desimal })}%`;

/** Rasio (0,25 = 25%) → persen berformat. Product Scorecard menyimpan tumbuh & porsi sebagai rasio. */
export const dariRasio = (r: number | null | undefined, desimal = 1): string =>
  r === null || r === undefined || !Number.isFinite(Number(r)) ? "-" : persen(Number(r) * 100, desimal);

export const teks = (v: unknown): string => (v === null || v === undefined || v === "" ? "-" : String(v));

/** Nilai metrik WatchPoint menurut satuannya: rupiah / persen / angka biasa. */
export function nilaiMetrik(v: number | null | undefined, unit: string | null | undefined): string {
  if (v === null || v === undefined) return "-";
  const u = (unit ?? "").toLowerCase();
  if (u === "rp" || u === "idr") return rp(v);
  if (u === "%" || u === "persen" || u === "pct") return persen(v);
  return unit ? `${angka(v, 2)} ${unit}` : angka(v, 2);
}

const TIER_CHURN: Record<string, string> = { active: "Churn Aktif", risk: "Risiko Churn", watch: "Pantau Tanpa Order" };

// ── Penyusun per laporan ─────────────────────────────────────────

async function kpiHod(): Promise<Laporan> {
  const b = await getWatchBoard();
  const n = (s: string) => b.hods.filter((h) => h.status === s).length;
  return {
    key: "kpi-hod",
    judul: "KPI per HoD",
    ringkasan: [
      { label: "Periode", nilai: teks(b.generatedFor) },
      { label: "Per tanggal", nilai: teks(b.asOf) },
      { label: "HoD", nilai: String(b.hods.length) },
      { label: "Hijau / Kuning / Merah", nilai: `${n("GREEN")} / ${n("YELLOW")} / ${n("RED")}` },
    ],
    header: ["HoD", "Peran", "Status HoD", "Metrik", "Target", "Aktual", "Pencapaian", "Status metrik", "Tren"],
    baris: b.hods.flatMap((h) =>
      h.metrics.map((m) => [
        h.name, h.role, h.status, m.label,
        nilaiMetrik(m.target, m.unit), nilaiMetrik(m.actual, m.unit),
        m.pct === null || m.pct === undefined ? "-" : persen(m.pct, 0), m.status, teks(m.trend),
      ]),
    ),
  };
}

async function pipeline(scope: DataScope): Promise<Laporan> {
  const p = await getPipeline(scope);
  const deals = p.stages.flatMap((s) => s.deals).sort((a, b) => Number(b.estimate_amount ?? 0) - Number(a.estimate_amount ?? 0));
  return {
    key: "pipeline",
    judul: "Sales Pipeline",
    ringkasan: [
      { label: "Total deal", nilai: angka(p.summary.total_deals) },
      { label: "Nilai total", nilai: rp(p.summary.total_value) },
      { label: "Nilai tertimbang", nilai: rp(p.summary.weighted_value) },
      { label: "Deal macet", nilai: angka(p.summary.stale_count) },
      ...p.stages.map((s) => ({ label: `Stage ${s.stage}`, nilai: `${angka(s.count)} deal · ${rp(s.total_value)}` })),
    ],
    header: ["Stage", "Customer", "Brand", "Produk", "Forecast", "Prob.", "Nilai", "Hari di stage", "PIC HoD", "Cabang"],
    baris: deals.map((d) => [
      teks(d.stage), teks(d.customer_name), teks(d.brand), teks(d.product), teks(d.forecast_category),
      dariRasio(d.probability, 0),
      rp(Number(d.estimate_amount ?? 0)), angka(d.days_in_stage), teks(d.pic_hod), teks(d.cabang),
    ]),
  };
}

async function arAging(scope: DataScope): Promise<Laporan> {
  const a = await arAgingByCustomer(scope);
  return {
    key: "ar-aging",
    judul: "AR Aging per Customer",
    ringkasan: [
      { label: "Customer berpiutang", nilai: angka(a.summary.total_customers) },
      { label: "Total outstanding", nilai: rp(a.summary.total_outstanding) },
      { label: "Lewat jatuh tempo", nilai: rp(a.summary.overdue_outstanding) },
      { label: "Prioritas kritis", nilai: angka(a.summary.kritis) },
    ],
    header: ["Customer", "Cabang", "AM", "Current", "1-30", "31-60", "61-90", "90+", "Total", "Umur tertua (hari)", "Prioritas"],
    baris: [...a.customers]
      .sort((x, y) => y.total - x.total)
      .map((c) => [
        c.name, teks(c.cabang), teks(c.am), rp(c.current), rp(c.b1_30), rp(c.b31_60), rp(c.b61_90), rp(c.b90plus),
        rp(c.total), angka(c.max_overdue), c.priority,
      ]),
  };
}

async function stok(): Promise<Laporan> {
  const s = await stockBranchSummary();
  return {
    key: "stok",
    judul: "Stock Status per Gudang",
    ringkasan: [
      { label: "Item di katalog", nilai: angka(s.item_mirror) },
      { label: "Item ada data gudang", nilai: angka(s.item_ada_data) },
      { label: "Item tanpa data gudang", nilai: angka(s.item_tanpa_data) },
      { label: "Item selisih", nilai: angka(s.item_selisih) },
      { label: "Selisih negatif", nilai: angka(s.item_selisih_negatif) },
      { label: "Cakupan", nilai: persen(s.cakupan_persen) },
      { label: "Terakhir diperbarui", nilai: teks(s.terakhir_update) },
    ],
    header: ["Kode", "Gudang", "Cabang", "Aktif", "Jumlah item", "Total qty", "Terakhir update"],
    baris: s.per_gudang.map((g) => [
      g.kode, teks(g.nama), teks(g.cabang), g.aktif ? "Ya" : "Tidak", angka(g.item_count), angka(g.total_qty), teks(g.terakhir_update),
    ]),
  };
}

async function produk(scope: DataScope): Promise<Laporan> {
  const d = await productScorecard({ level: "kategori", margin: false, scope });
  return {
    key: "produk",
    judul: "Product Performance per Kategori",
    ringkasan: [
      { label: "Periode", nilai: `${teks(d.range.from)} s/d ${teks(d.range.to)}` },
      { label: "Revenue", nilai: rp(d.ringkas.revenue) },
      { label: "Revenue periode sebelumnya", nilai: rp(d.ringkas.revenue_sebelum) },
      { label: "Revenue tahun lalu", nilai: rp(d.ringkas.revenue_tahun_lalu) },
    ],
    header: ["Kategori", "Revenue", "vs periode sebelumnya", "vs tahun lalu", "Porsi", "Qty", "Customer", "Item"],
    baris: [...d.rows]
      .sort((a, b) => b.revenue - a.revenue)
      .map((r) => [
        teks(r.label), rp(r.revenue), dariRasio(r.tumbuh_sebelum), dariRasio(r.tumbuh_tahun_lalu), dariRasio(r.porsi),
        angka(r.qty), angka(r.customer), angka(r.item),
      ]),
  };
}

async function churn(scope: DataScope): Promise<Laporan> {
  const c = await churnCustomers(60, scope);
  return {
    key: "churn",
    judul: "Churn Analysis Customer",
    ringkasan: [
      { label: "Ambang tanpa order", nilai: `${angka(c.summary.churn_days)} hari` },
      { label: "Churn aktif", nilai: angka(c.summary.active) },
      { label: "Risiko churn", nilai: angka(c.summary.risk) },
      { label: "Pantau tanpa order", nilai: angka(c.summary.watch) },
      { label: "Nilai historis berisiko", nilai: rp(c.summary.value_at_risk) },
    ],
    header: ["Tier", "Customer", "Cabang", "AM", "Revenue historis", "Order terakhir", "Hari tanpa order", "Total order"],
    baris: [...c.customers]
      .sort((a, b) => (b.days_since ?? 0) - (a.days_since ?? 0))
      .map((x) => [
        TIER_CHURN[x.tier] ?? x.tier, x.name, teks(x.cabang), teks(x.am), rp(x.total), teks(x.last_date),
        x.days_since === null || x.days_since === undefined ? "-" : angka(x.days_since), angka(x.invoices),
      ]),
  };
}

export function susunLaporan(key: KeyLaporan, scope: DataScope): Promise<Laporan> {
  switch (key) {
    case "kpi-hod": return kpiHod();
    case "pipeline": return pipeline(scope);
    case "ar-aging": return arAging(scope);
    case "stok": return stok();
    case "produk": return produk(scope);
    case "churn": return churn(scope);
  }
}

/** Bentuk JSON untuk layar: ringkasan + BARIS_PRATINJAU baris pertama + jumlah baris sebenarnya. */
export function pratinjau(l: Laporan) {
  return { key: l.key, judul: l.judul, ringkasan: l.ringkasan, header: l.header, total_baris: l.baris.length, baris: l.baris.slice(0, BARIS_PRATINJAU) };
}
