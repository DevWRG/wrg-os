// F76 — WatchPoint HoD Dashboard (metric-based, DB-backed).
//
// Spec: PRD-Sales-Batch-3 §F76 + HOD-Prompt-Workflow §3 (brief Direktur Juni 2026).
// Tiap HoD punya daftar WatchPoint metric (Target vs Aktual) dengan threshold gate:
//   🟢 GREEN  : aktual ≥ target (attainment ≥ 100%)
//   🟡 YELLOW : 50% ≤ attainment < 100%
//   🔴 RED    : attainment < 50%
// Metric "lower is better" (AR overdue, churn, lead time) di-invert.
//
// Sumber — nol angka/ konfigurasi hardcoded:
//   - computed live dari DB: Accurate mirror + sales_plan + ar_aging_mv
//   - mapping HoD→cabang: tabel `hod_territory` (import dari AREA PER HOD.xlsx)
//   - metric manual: tabel `watchpoint_metric` (diisi HoD). Kosong → status NA.
//   - target: default = brief Direktur Juni 2026, boleh ditimpa per metric lewat
//     watchpoint_metric.target_mode/target_override (migrasi 080) supaya revisi
//     kesepakatan Direktur–HoD tidak perlu deploy.

import { db, isDbEnabled } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { arOver90Outstanding } from "./ar.js";
import { currentWeek, weekRange, periodeLabel } from "./watchpoint-week.js";

export type WatchStatus = "GREEN" | "YELLOW" | "RED" | "NA";
export type WatchTrend = "improving" | "stable" | "declining";

export interface WatchMetric {
  key: string;
  label: string;
  target: number | null;
  actual: number | null;
  unit: string;
  direction: "higher" | "lower";
  source: "db" | "manual";
  pct: number | null;
  status: WatchStatus;
  trend: WatchTrend;
  note?: string;
  /** Asal target: 'default' = angka brief Direktur di kode, sisanya override DB. */
  targetMode: "default" | "value" | "milestone";
  /** Target bawaan kode — dipakai UI untuk menawarkan "kembalikan ke default". */
  defaultTarget: number | null;
}

export interface HodWatch {
  key: string;
  name: string;
  role: string;
  status: WatchStatus;
  metrics: WatchMetric[];
}

export interface WatchBoard {
  source: "computed";
  generatedFor: string;
  asOf: string;
  hods: HodWatch[];
  meta: {
    gate: string;
    legend: Record<WatchStatus, string>;
    pending: string[];
  };
}

// ── Threshold engine ──────────────────────────────────────────────
// Diekspor: dipakai ulang oleh watchpoint-weekly.ts supaya papan mingguan
// memakai gate yang SAMA persis (jangan duplikasi ambang di dua tempat).
export function attainment(target: number | null, actual: number | null, dir: "higher" | "lower"): number | null {
  if (target === null || actual === null) return null;
  if (dir === "lower") {
    if (target === 0) return actual <= 0 ? 100 : 0;
    if (actual <= 0) return 100;
    return Math.min((target / actual) * 100, 999);
  }
  if (target === 0) return actual >= 0 ? 100 : 0;
  return (actual / target) * 100;
}

export function gate(pct: number | null): WatchStatus {
  if (pct === null) return "NA";
  if (pct >= 100) return "GREEN";
  if (pct >= 50) return "YELLOW";
  return "RED";
}

export function worst(metrics: { status: WatchStatus }[]): WatchStatus {
  if (metrics.some((m) => m.status === "RED")) return "RED";
  if (metrics.some((m) => m.status === "YELLOW")) return "YELLOW";
  if (metrics.some((m) => m.status === "GREEN")) return "GREEN";
  return "NA";
}

// ── DB derivations (Accurate mirror + AR + plan). cabang dari hod_territory. ──
type Sql = ReturnType<typeof db>;

/**
 * Jendela periode untuk metric yang sifatnya "capaian sepanjang periode"
 * (revenue, produktivitas, kunjungan, akun baru, fill rate).
 *
 * KENAPA ADA. Sebelumnya metric-metric itu memaku `date_trunc('month')` sendiri,
 * sementara papan Weekly membekukan hasilnya sebagai angka MINGGUAN. Snapshot W31
 * (diambil Senin 3 Agustus 06:00) karena itu mencatat revenue Rocky = 0 — bukan
 * karena minggu itu sepi (nyatanya Rp 277 jt dari 64 faktur), melainkan karena
 * month-to-date Agustus saat itu baru mencakup 1–2 Agustus yang kebetulan akhir
 * pekan tanpa faktur. W32 tampak benar hanya karena kebetulan kalender yang sama;
 * bulan yang tidak diawali akhir pekan akan salah tanpa ada yang menyadari.
 *
 * Metric KUMULATIF (fia/xsell = YTD) dan TITIK-WAKTU (ar90, noorder, churn)
 * sengaja mengabaikan jendela ini — periodenya bukan urusan papan.
 */
export interface PeriodWindow {
  from: string; // YYYY-MM-DD inklusif
  to: string;   // YYYY-MM-DD inklusif
}

/** Jendela default papan harian: awal bulan → hari ini (WIB, bukan UTC). */
export function monthToDateWindow(): PeriodWindow {
  const now = new Date(Date.now() + 7 * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return { from: `${y}-${m}-01`, to: now.toISOString().slice(0, 10) };
}

// Revenue NETTO (tanpa PPN) — sebasis dengan Sales Analytics; kalau di sini
// pakai ai.total bruto, dua menu menampilkan angka berbeda untuk periode sama.
async function revenueInWindow(sql: Sql, cabang: string[], win: PeriodWindow): Promise<number> {
  if (!cabang.length) return 0;
  const rows = await sql<{ v: number }[]>`
    SELECT COALESCE(sum(ai.total - COALESCE(ai.tax_amount, 0)),0)::float8 AS v
    FROM accurate_invoice ai
    LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
    ${joinAmFromSalesman(sql)}
    WHERE ai.tanggal >= ${win.from}::date AND ai.tanggal <= ${win.to}::date
      AND mu.cabang = ANY(${cabang})`;
  return Number(rows[0]?.v ?? 0);
}

// Penyebut metric "per AM" = roster AM aktif di cabang HoD (master_user), BUKAN
// jumlah record accurate_salesman: satu AM bisa punya beberapa kode salesman
// (kode lama/dobel) sehingga penyebutnya menggelembung dan produktivitas jadi
// terlihat rendah. Definisi roster sama dengan npk-am.ts / visit.ts.
async function amCount(sql: Sql, cabang: string[]): Promise<number> {
  if (!cabang.length) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM master_user mu
    WHERE mu.aktif AND upper(COALESCE(mu.role, '')) = 'AM'
      AND mu.cabang = ANY(${cabang})`;
  return Number(rows[0]?.n ?? 0);
}

async function productivity(sql: Sql, cabang: string[], win: PeriodWindow): Promise<number> {
  const r = await revenueInWindow(sql, cabang, win);
  const n = await amCount(sql, cabang);
  return n ? r / n : 0;
}

// AR >90 hari diambil dari repo/ar.ts (arOver90Outstanding) supaya identik
// dengan menu AR. Query lama di sini salah dua kali: filter bucket '>90'
// (nilai sebenarnya '90+', jadi tak pernah kena → 0 → hijau permanen) dan
// sum(amount) mentah (nilai faktur asli, bukan sisa tagihan).

async function noOrderOver(sql: Sql, days: number): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT customer_id FROM accurate_invoice
      GROUP BY customer_id HAVING max(tanggal) < CURRENT_DATE - ${days}::int
    ) q`;
  return Number(rows[0]?.n ?? 0);
}

// "Akuisisi 2 akun baru/bln" (brief Direktur). Akun baru = customer yang faktur
// PERTAMA-nya (sepanjang mirror) jatuh di bulan berjalan — bukan sekadar customer
// yang bertransaksi bulan ini. Atribusi cabang diambil dari AM pada faktur
// pertama itu, jadi akun tetap dihitung untuk wilayah yang membukanya walau
// nanti pindah pemilik.
//
// Catatan batas: "pertama" hanya sejauh mirror `accurate_invoice`; customer yang
// faktur perdananya mendahului awal mirror bisa salah terhitung sebagai baru.
async function newAccountsInWindow(sql: Sql, cabang: string[], win: PeriodWindow): Promise<number> {
  if (!cabang.length) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT DISTINCT ON (ai.customer_id) ai.customer_id, mu.cabang
      FROM (
        SELECT customer_id, min(tanggal) AS first_date
        FROM accurate_invoice
        WHERE customer_id IS NOT NULL
        GROUP BY customer_id
      ) f
      JOIN accurate_invoice ai
        ON ai.customer_id = f.customer_id AND ai.tanggal = f.first_date
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE f.first_date >= ${win.from}::date AND f.first_date <= ${win.to}::date
      ORDER BY ai.customer_id, ai.id
    ) q
    WHERE q.cabang = ANY(${cabang})`;
  return Number(rows[0]?.n ?? 0);
}

// Fill rate (Ika) — BASIS SO (migrasi 096): dari pesanan yang MASUK bulan ini,
// berapa persen qty-nya sudah terkirim. Se-perusahaan (bukan per cabang — mirror
// SO/DO tak menyimpan cabang, dan Finance & SC memang lingkupnya nasional).
//
// Penautannya per BARIS, bukan per dokumen: accurate_delivery_order_item
// .sales_order_detail_id → accurate_sales_order_item.line_id. Satu SO bisa berisi
// banyak item dengan tingkat pemenuhan berbeda, jadi per dokumen akan menyamarkan
// item yang kurang. Pengiriman dihitung tanpa memandang tanggal DO-nya — kiriman
// September atas pesanan Agustus tetap masuk ke Agustus, karena periodenya
// ditentukan tanggal PESANAN.
//
// Diganti dari definisi lama (agregat qty SO vs qty DO dalam bulan yang sama)
// yang terdistorsi pesanan lintas bulan dan tak bisa ditelusuri ke SO mana pun.
//
// KONSEKUENSI YANG HARUS DIINGAT: angka bulan berjalan BELUM FINAL — pesanan yang
// baru masuk beberapa hari lalu wajar belum terkirim penuh, jadi nilainya menanjak
// sepanjang bulan. Bandingkan antar bulan penuh, bukan bulan berjalan vs bulan lalu.
//
// Over-delivery tidak dipotong di level baris: kalau kiriman melebihi pesanan,
// kelebihannya ikut terhitung dan hasilnya bisa >100%. Itu sinyal yang memang perlu
// terlihat, bukan disembunyikan dengan LEAST(). Baris DO tanpa tautan SO (98,9%
// terkait; sisanya merujuk SO lebih tua dari jendela mirror) tidak ikut sama sekali.
//
// Balikan null saat belum ada qty order sama sekali → N/A, bukan 0%.
async function fillRateInWindow(sql: Sql, win: PeriodWindow): Promise<number | null> {
  const rows = await sql<{ ordered: number | null; delivered: number | null }[]>`
    WITH so_line AS (
      SELECT i.line_id, i.qty
        FROM accurate_sales_order_item i
        JOIN accurate_sales_order o ON o.id = i.order_id
       WHERE o.trans_date >= ${win.from}::date AND o.trans_date <= ${win.to}::date
         AND i.line_id IS NOT NULL
    )
    SELECT
      (SELECT sum(qty) FROM so_line)::float8 AS ordered,
      (SELECT sum(d.qty) FROM accurate_delivery_order_item d
         JOIN so_line s ON s.line_id = d.sales_order_detail_id)::float8 AS delivered`;
  const ordered = Number(rows[0]?.ordered ?? 0);
  if (!(ordered > 0)) return null;
  return (Number(rows[0]?.delivered ?? 0) / ordered) * 100;
}

// ── Metric Mufid (Business IVD): FIA & cross-sell reguler→CLIA ──────────────
//
// KENAPA COCOK-NAMA, BUKAN KLASIFIKASI PRODUK. Cara yang "benar" adalah lewat
// product_code → product_line (lini Imunology = CLIA, POCT Imunology = FIA).
// Itu TIDAK bisa dipakai per 2026-08-13: seluruh keluarga LIAISON XL (DiaSorin)
// — Rp 532 jt YTD, penyumbang CLIA terbesar — sama sekali tak ada di pricebook,
// begitu pula MAGLUMI T3/TSH/T4. Lini Imunology cuma memuat 8 produk
// SNIBE/TOSOH/ORGENTEC. Diukur lewat klasifikasi, CLIA hanya tampak 1 pelanggan
// padahal nyatanya Rp 563,9 jt / 15 pelanggan menggantung tanpa klasifikasi.
//
// Angka kecil yang percaya diri lebih berbahaya daripada NA: ia membuat bisnis
// Mufid terlihat sepi. Jadi metric ini membaca nama item Accurate langsung —
// mencakup semua yang benar-benar terjual, tak bergantung kelengkapan pricebook.
//
// PINDAHKAN KE KLASIFIKASI begitu produk-produk itu didaftarkan; pola nama rapuh
// terhadap penulisan baru (mis. merek CLIA baru yang namanya tak memuat 'CLIA').
const RE_FIA = "FIA METER|FLUORESCEN|IMMUNOASSAY";
const RE_CLIA = "CLIA|MAGLUMI|LIAISON";

// PERIODE = YTD, bukan bulan berjalan seperti revenue/visits. Alasannya bukan
// selera: sepanjang 2026 baru 11 pelanggan FIA, jadi target 20 mustahil dibaca
// sebagai target BULANAN — ia jelas capaian kumulatif. Mirror accurate_invoice
// mulai 2026-01-05, jadi YTD = seluruh data yang ada (bukan potongan sebagian).
async function fiaCustomersYtd(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(DISTINCT inv.customer_id)::int AS n
      FROM accurate_invoice_item ii
      JOIN accurate_invoice inv ON inv.id = ii.invoice_id
      JOIN accurate_item ai ON ai.id::text = ii.item_id::text
     WHERE inv.tanggal >= date_trunc('year', CURRENT_DATE)
       AND ai.name ~* ${RE_FIA}`;
  return Number(rows[0]?.n ?? 0);
}

// Cross-sell = pelanggan yang SUDAH beli non-CLIA lebih dulu, lalu faktur CLIA
// PERTAMA-nya jatuh tahun ini. Urutan itu yang membedakan cross-sell dari
// pelanggan CLIA baru: tanpa syarat "reguler duluan", akun yang langsung masuk
// lewat CLIA ikut terhitung dan targetnya jadi tak bermakna.
async function xsellRegulerKeClia(sql: Sql): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    WITH baris AS (
      SELECT inv.customer_id, inv.tanggal, (ai.name ~* ${RE_CLIA}) AS is_clia
        FROM accurate_invoice_item ii
        JOIN accurate_invoice inv ON inv.id = ii.invoice_id
        JOIN accurate_item ai ON ai.id::text = ii.item_id::text
       WHERE inv.customer_id IS NOT NULL
    ),
    clia_pertama AS (
      SELECT customer_id, min(tanggal) AS mulai FROM baris WHERE is_clia GROUP BY 1
    )
    SELECT count(*)::int AS n
      FROM clia_pertama p
     WHERE p.mulai >= date_trunc('year', CURRENT_DATE)
       AND EXISTS (SELECT 1 FROM baris b
                    WHERE b.customer_id = p.customer_id AND NOT b.is_clia AND b.tanggal < p.mulai)`;
  return Number(rows[0]?.n ?? 0);
}

async function churnRutin(sql: Sql, cabang: string[]): Promise<number> {
  if (!cabang.length) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM (
      SELECT ai.customer_id
      FROM accurate_invoice ai
      LEFT JOIN accurate_salesman acs ON acs.id = ai.salesman_id
      ${joinAmFromSalesman(sql)}
      WHERE mu.cabang = ANY(${cabang})
      GROUP BY ai.customer_id
      HAVING count(*) >= 3 AND max(ai.tanggal) < CURRENT_DATE - 60
    ) q`;
  return Number(rows[0]?.n ?? 0);
}

// Kunjungan TEREALISASI = sales_plan.reported (definisi yang dipakai seluruh
// repo: dailysummary/digest/compliance/npk-am). Menghitung semua baris plan
// akan menghitung rencana yang tak pernah dilaporkan sebagai kunjungan.
async function visitsInWindow(sql: Sql, cabang: string[], win: PeriodWindow): Promise<number> {
  if (!cabang.length) return 0;
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM sales_plan sp
    JOIN master_user mu ON mu.am_id = sp.am_id
    WHERE mu.cabang = ANY(${cabang})
      AND sp.reported
      AND sp.tanggal >= ${win.from}::date AND sp.tanggal <= ${win.to}::date`;
  return Number(rows[0]?.n ?? 0);
}

// Target "48 kunjungan/bln" itu beban SATU AM (±2–3 kunjungan/hari kerja),
// sebaris dengan "Produktivitas ≥ Rp 500jt/AM" di brief Direktur — jadi yang
// dibandingkan adalah rata-rata per AM, bukan total se-wilayah HoD (yang untuk
// 6 cabang pasti lewat target tanpa arti).
async function visitsPerAm(sql: Sql, cabang: string[], win: PeriodWindow): Promise<number> {
  const v = await visitsInWindow(sql, cabang, win);
  const n = await amCount(sql, cabang);
  return n ? v / n : 0;
}

// ── Definisi metric per HoD (tanpa nilai/konfig cabang hardcoded) ──
interface MetricDef {
  key: string;
  label: string;
  target: number | null;
  unit: string;
  direction: "higher" | "lower";
  trend: WatchTrend;
  // compute ada = source 'db' (terima cabang HoD dari hod_territory).
  // Balikan null = "datanya memang belum ada" → metric jadi N/A, BUKAN 0.
  // Penting untuk metric rasio: 0 akan terbaca sebagai merah, padahal artinya
  // tak ada penyebut (mis. belum ada order bulan ini).
  // `win` = jendela periode papan (bulan berjalan untuk papan harian, rentang
  // minggu ISO untuk papan Weekly). Metric kumulatif/titik-waktu mengabaikannya.
  compute?: (sql: Sql, cabang: string[], win: PeriodWindow) => Promise<number | null>;
}

interface HodDef {
  key: string;
  name: string;
  role: string;
  metrics: MetricDef[];
}

const BIO = 1_000_000_000;
const JT = 1_000_000;

const SALES_METRICS = (): MetricDef[] => [
  { key: "revenue", label: "Revenue/bln", target: 2.5 * BIO, unit: "Rp", direction: "higher", trend: "stable", compute: (s, c, w) => revenueInWindow(s, c, w) },
  { key: "prod", label: "Produktivitas/AM", target: 500 * JT, unit: "Rp", direction: "higher", trend: "stable", compute: (s, c, w) => productivity(s, c, w) },
  { key: "visits", label: "Kunjungan/AM/bln", target: 48, unit: "kunjungan", direction: "higher", trend: "stable", compute: (s, c, w) => visitsPerAm(s, c, w) },
  { key: "newacct", label: "Akun baru/bln", target: 2, unit: "akun", direction: "higher", trend: "stable", compute: (s, c, w) => newAccountsInWindow(s, c, w) },
  { key: "churn", label: "Churn RUTIN", target: 0, unit: "customer", direction: "lower", trend: "stable", compute: (s, c) => churnRutin(s, c) },
];

const HOD_DEFS: HodDef[] = [
  { key: "rocky", name: "Rocky", role: "Sales East", metrics: SALES_METRICS() },
  { key: "yogi", name: "Yogi", role: "Sales West", metrics: SALES_METRICS() },
  {
    key: "mufid", name: "Mufid", role: "Business IVD", metrics: [
      { key: "clia", label: "Site CLIA ≥800 tes/bln", target: 3, unit: "site", direction: "higher", trend: "stable" },
      { key: "fia", label: "FIA customer", target: 20, unit: "customer", direction: "higher", trend: "stable", compute: (s) => fiaCustomersYtd(s) },
      { key: "jv", label: "JV principal baru", target: 1, unit: "JV", direction: "higher", trend: "stable" },
      { key: "xsell", label: "Cross-sell reguler→CLIA", target: 2, unit: "deal", direction: "higher", trend: "stable", compute: (s) => xsellRegulerKeClia(s) },
      { key: "moq", label: "MOQ Snibe diputus", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "arman", name: "Arman", role: "Business Medical & HD", metrics: [
      { key: "hd", label: "Site HD maju 1 milestone", target: 1, unit: "site", direction: "higher", trend: "stable" },
      { key: "okupansi", label: "Okupansi tindakan/mesin/bln", target: 48, unit: "tindakan", direction: "higher", trend: "stable" },
      { key: "coloc", label: "Co-location CLIA (Permenkes 3/2023)", target: 3, unit: "site", direction: "higher", trend: "stable" },
      { key: "jv", label: "JV principal (Edan/Miki/Oneject)", target: 1, unit: "JV", direction: "higher", trend: "stable" },
      { key: "xsell", label: "Cross-sell", target: 2, unit: "deal", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "pakMuhid", name: "Pak Muhid", role: "Aftersales", metrics: [
      { key: "uptime", label: "Uptime/analyzer", target: 95, unit: "%", direction: "higher", trend: "stable" },
      { key: "rar", label: "RaR/cabang", target: 202 * JT, unit: "Rp", direction: "higher", trend: "stable" },
      { key: "install", label: "Lead time install", target: 7, unit: "hari", direction: "lower", trend: "stable" },
      { key: "noorder", label: "Customer no-order >60 hari", target: 0, unit: "customer", direction: "lower", trend: "stable", compute: (s) => noOrderOver(s, 60) },
    ],
  },
  {
    key: "ika", name: "Ika", role: "Finance & SC", metrics: [
      { key: "ar90", label: "AR overdue >90 hari", target: 500 * JT, unit: "Rp", direction: "lower", trend: "stable", compute: () => arOver90Outstanding() },
      { key: "fillrate", label: "Fill rate", target: 95, unit: "%", direction: "higher", trend: "stable", compute: (s, _c, w) => fillRateInWindow(s, w) },
      { key: "refi", label: "Milestone refinancing", target: 1, unit: "milestone", direction: "higher", trend: "stable" },
      { key: "runway", label: "Cash runway mingguan", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "fafa", name: "Fafa", role: "Accounting & Tax", metrics: [
      { key: "close", label: "Close cycle", target: 10, unit: "hari", direction: "lower", trend: "stable" },
      { key: "opex", label: "OPEX ratio", target: 35, unit: "%", direction: "lower", trend: "stable" },
      { key: "revstream", label: "Revenue-by-stream report", target: null, unit: "", direction: "higher", trend: "stable" },
      { key: "gp", label: "GP per stream report", target: null, unit: "", direction: "higher", trend: "stable" },
    ],
  },
  {
    key: "husni", name: "Husni", role: "BD & GA ⭐ KEYSTONE", metrics: [
      { key: "spine", label: "Data Spine MVP LIVE", target: null, unit: "", direction: "higher", trend: "improving" },
      { key: "orch", label: "Orchestrating database", target: null, unit: "", direction: "higher", trend: "improving" },
      { key: "dash", label: "Dashboard LIVE", target: null, unit: "", direction: "higher", trend: "improving" },
    ],
  },
];

const LEGEND: Record<WatchStatus, string> = {
  GREEN: "≥ target",
  YELLOW: "50–99% target",
  RED: "< 50% target",
  NA: "Belum ada data",
};

const PENDING: string[] = [
  "Metric manual (JV, CLIA, uptime, refinancing, dll) diisi lewat tombol ubah di kartu HoD — kosong → N/A",
  "Mapping HoD→cabang dari tabel hod_territory (import AREA PER HOD.xlsx) — kosong → metric cabang = 0",
  "3 leverage AI-suggest per HoD (F85) menyusul",
];

// ── Loader manual & territory dari DB ─────────────────────────────
type TargetMode = "default" | "value" | "milestone";

interface ManualRow {
  actual: number | null;
  status_override: string | null;
  note: string | null;
  target_override: number | null;
  target_mode: TargetMode;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function loadManual(sql: Sql): Promise<Map<string, ManualRow>> {
  const rows = await sql<{
    hod_key: string; metric_key: string; actual: number | null; status_override: string | null;
    note: string | null; target_override: number | null; target_mode: string | null;
  }[]>`
    SELECT hod_key, metric_key, actual, status_override, note, target_override, target_mode
    FROM watchpoint_metric`;
  const m = new Map<string, ManualRow>();
  for (const r of rows) {
    const mode = r.target_mode === "value" || r.target_mode === "milestone" ? r.target_mode : "default";
    m.set(`${r.hod_key}:${r.metric_key}`, {
      actual: num(r.actual),
      status_override: r.status_override,
      note: r.note,
      target_override: num(r.target_override),
      target_mode: mode,
    });
  }
  return m;
}

/** Target efektif: override dari DB kalau ada, selain itu angka default di kode. */
function effectiveTarget(def: number | null, row: ManualRow | undefined): number | null {
  if (!row || row.target_mode === "default") return def;
  if (row.target_mode === "milestone") return null;
  return row.target_override ?? def;
}

async function loadTerritory(sql: Sql): Promise<Map<string, string[]>> {
  const rows = await sql<{ hod_key: string; cabang: string }[]>`SELECT hod_key, cabang FROM hod_territory`;
  const m = new Map<string, string[]>();
  for (const r of rows) {
    const a = m.get(r.hod_key) ?? [];
    a.push(r.cabang);
    m.set(r.hod_key, a);
  }
  return m;
}

const VALID_STATUS = new Set<WatchStatus>(["GREEN", "YELLOW", "RED", "NA"]);

async function buildMetric(
  sql: Sql | null,
  hodKey: string,
  d: MetricDef,
  manual: Map<string, ManualRow>,
  cabang: string[],
  win: PeriodWindow,
): Promise<WatchMetric> {
  const row = manual.get(`${hodKey}:${d.key}`);
  const target = effectiveTarget(d.target, row);

  let actual: number | null;
  let source: "db" | "manual";
  let override: WatchStatus | undefined;

  // Catatan & status manual berlaku untuk metric apa pun — termasuk yang
  // angkanya computed (mis. "AR >90 turun karena 2 faskes bayar minggu ini").
  const note = row?.note ?? undefined;
  if (row?.status_override && VALID_STATUS.has(row.status_override as WatchStatus)) {
    override = row.status_override as WatchStatus;
  }

  if (d.compute && sql) {
    source = "db";
    try {
      actual = await d.compute(sql, cabang, win);
    } catch {
      actual = null;
      source = "manual";
    }
  } else {
    source = "manual";
    actual = row?.actual ?? null;
  }

  const pct = attainment(target, actual, d.direction);
  const status = target === null ? override ?? "NA" : gate(pct);
  return {
    key: d.key, label: d.label, target, actual, unit: d.unit,
    direction: d.direction, source, pct, status, trend: d.trend, note,
    targetMode: row?.target_mode ?? "default", defaultTarget: d.target,
  };
}

/**
 * Papan WatchPoint per HoD — computed dari DB, cabang dari hod_territory, manual
 * dari watchpoint_metric.
 *
 * `win` menentukan periode metric capaian (revenue/prod/visits/newacct/fillrate).
 * Default = bulan berjalan, yaitu perilaku papan harian. Papan Weekly memanggilnya
 * dengan rentang minggu ISO supaya angka mingguan benar-benar mingguan — tanpa itu
 * snapshot mingguan membekukan angka month-to-date dan minggu pertama tiap bulan
 * tercatat nyaris nol.
 */
export async function getWatchBoard(win: PeriodWindow = monthToDateWindow()): Promise<WatchBoard> {
  const sql = isDbEnabled() ? db() : null;
  const manual = sql ? await loadManual(sql) : new Map<string, ManualRow>();
  const territory = sql ? await loadTerritory(sql) : new Map<string, string[]>();
  const hods: HodWatch[] = [];
  for (const h of HOD_DEFS) {
    const cabang = territory.get(h.key) ?? [];
    const metrics = await Promise.all(h.metrics.map((m) => buildMetric(sql, h.key, m, manual, cabang, win)));
    hods.push({ key: h.key, name: h.name, role: h.role, status: worst(metrics), metrics });
  }
  const cur = currentWeek();
  const { from, to } = weekRange(cur.isoYear, cur.isoWeek);
  return {
    source: "computed",
    // Minggu ISO berjalan (WIB) — jangan dipatok teks: papan ini dibaca tiap
    // Senin, label yang tertinggal di sprint lama bikin angka terbaca basi.
    generatedFor: `W${cur.isoWeek} · ${periodeLabel(from, to)}`,
    asOf: new Date().toISOString(),
    hods,
    meta: { gate: "🟢 ≥ target · 🟡 50–99% · 🔴 < 50%", legend: LEGEND, pending: PENDING },
  };
}

// ── Tulis: target & nilai manual per metric (migrasi 080) ─────────

export interface WatchMetricPatch {
  hodKey: string;
  metricKey: string;
  /** Hanya dipakai metric manual; metric computed mengabaikannya. */
  actual: number | null;
  /** Status manual untuk metric milestone (target null). null = auto dari gate. */
  status: WatchStatus | null;
  note: string | null;
  targetMode: TargetMode;
  /** Wajib angka saat targetMode 'value'. */
  targetOverride: number | null;
  updatedBy: string | null;
}

/** Definisi metric (hod, key) dari katalog — null kalau pasangan itu tak dikenal. */
export function findMetricDef(hodKey: string, metricKey: string): { hod: HodDef; metric: MetricDef } | null {
  const hod = HOD_DEFS.find((h) => h.key === hodKey);
  if (!hod) return null;
  const metric = hod.metrics.find((m) => m.key === metricKey);
  return metric ? { hod, metric } : null;
}

/** Katalog metric per HoD (tanpa nilai) — dipakai validasi & referensi klien. */
export function listMetricDefs(): { hodKey: string; metricKey: string; label: string; defaultTarget: number | null; unit: string; computed: boolean }[] {
  return HOD_DEFS.flatMap((h) =>
    h.metrics.map((m) => ({
      hodKey: h.key, metricKey: m.key, label: m.label,
      defaultTarget: m.target, unit: m.unit, computed: Boolean(m.compute),
    })),
  );
}

export async function upsertWatchMetric(p: WatchMetricPatch): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO watchpoint_metric
      (hod_key, metric_key, actual, status_override, note, target_override, target_mode, updated_by, updated_at)
    VALUES (${p.hodKey}, ${p.metricKey}, ${p.actual}, ${p.status}, ${p.note},
            ${p.targetOverride}, ${p.targetMode}, ${p.updatedBy}, now())
    ON CONFLICT (hod_key, metric_key) DO UPDATE SET
      actual          = EXCLUDED.actual,
      status_override = EXCLUDED.status_override,
      note            = EXCLUDED.note,
      target_override = EXCLUDED.target_override,
      target_mode     = EXCLUDED.target_mode,
      updated_by      = EXCLUDED.updated_by,
      updated_at      = now()`;
}

/** Hapus baris → metric balik ke default kode (target) & N/A (nilai manual). */
export async function deleteWatchMetric(hodKey: string, metricKey: string): Promise<{ deleted: boolean }> {
  const sql = db();
  const rows = await sql`
    DELETE FROM watchpoint_metric
    WHERE hod_key = ${hodKey} AND metric_key = ${metricKey}
    RETURNING hod_key`;
  return { deleted: rows.length > 0 };
}

// ── Formatter pesan WA per-HoD (dipakai endpoint kirim WA) ────────
const WA_STATUS: Record<WatchStatus, string> = {
  GREEN: "🟢 Hijau",
  YELLOW: "🟡 Kuning",
  RED: "🔴 Merah",
  NA: "⚪ N/A",
};
const WA_TREND: Record<WatchTrend, string> = { improving: "↗︎", stable: "→", declining: "↘︎" };
const WA_MILESTONE: Record<WatchStatus, string> = { GREEN: "Live", YELLOW: "WIP", RED: "Off", NA: "—" };

function fmtWaVal(v: number | null, unit: string): string {
  if (v === null) return "—";
  if (unit === "Rp") return "Rp " + new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  if (unit === "%") return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
  return `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(v)}${unit ? " " + unit : ""}`;
}

/** Ringkasan WatchPoint 1 HoD jadi teks WA (markdown WA: *bold* / _italic_). */
export function formatHodWatchWa(hod: HodWatch, asOf: string): string {
  const lines: string[] = [
    `*WatchPoint HoD — ${hod.name}*`,
    hod.role,
    `Status: ${WA_STATUS[hod.status]}`,
    "",
  ];
  for (const m of hod.metrics) {
    const dot = WA_STATUS[m.status].split(" ")[0];
    const val =
      m.target === null
        ? WA_MILESTONE[m.status]
        : `${fmtWaVal(m.actual, m.unit)} / ${fmtWaVal(m.target, m.unit)}${m.pct !== null ? ` (${Math.round(m.pct)}%)` : ""}`;
    lines.push(`${dot} ${m.label}: ${val} ${WA_TREND[m.trend]}`);
  }
  const ts = new Date(asOf).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  lines.push("", `_per ${ts} WIB · WRG-OS_`);
  return lines.join("\n");
}
