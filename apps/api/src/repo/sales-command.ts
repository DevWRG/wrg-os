// Sales Command Center (#1979) — cockpit HoD per region.
//
// Satu layar yang MENGUMPULKAN sinyal yang sudah dihitung modul lain; berkas ini
// sengaja tak punya rumus sendiri (tak ada tabel baru, tak ada angka yang bisa
// menyimpang dari menu asalnya):
//   pacing bulan berjalan  → so-pacing.ts      (F21, per region)
//   capaian YTD per AM     → sales.ts targetPacing
//   lampu AM               → exec-dashboard.ts execAmRadar (AM Radar)
//   PLAN/REPORT minggu ini → plandash.ts reportCompliance (F57)
//   deal macet / Dormant   → deal.ts getPipeline (F174, opsi utama saja)
//   keaslian pipeline      → pipeline-keaslian.ts (F4)
//   AR > 90 hari           → ar.ts arAgingByCustomer
//   alert aktif            → sales-analytics-config.ts listAlerts (milik penonton)
//
// Akses: HoD sales → region timnya sendiri (parameter region diabaikan); Direktur /
// admin / superuser → pilih region. Selain itu ditolak. Region diturunkan dari
// hod_territory lewat cabangRegionMap — tak ada nama orang di berkas ini.

import { db } from "../db.js";
import { FULL_SCOPE, type DataScope } from "./access-scope.js";
import { cabangRegionMap, targetPacing } from "./sales.js";
import { getSoPacing } from "./so-pacing.js";
import { execAmRadar } from "./exec-dashboard.js";
import { reportCompliance } from "./plandash.js";
import { getPipeline } from "./deal.js";
import { keaslianPipeline } from "./pipeline-keaslian.js";
import { arAgingByCustomer } from "./ar.js";
import { listAlerts } from "./sales-analytics-config.js";
import { waHod } from "./hod-wa.js";
import { isoWeek } from "./faktur.js";
import { sendViaWaGateway } from "../wasend.js";

export type RegionSales = "East" | "West";
export const REGION_SALES: RegionSales[] = ["East", "West"];

export class SalesCommandError extends Error {
  constructor(public status: 400 | 403, message: string) { super(message); }
}

const upper = (s: string) => s.trim().toUpperCase();

/**
 * Murni: region yang boleh dilihat. HoD terkunci ke region cabang timnya (permintaan
 * diabaikan — mencegah HoD mengintip region lain lewat ?region=). Pemegang scope
 * penuh dengan peran Direktur/admin atau superuser boleh memilih.
 */
export function tentukanRegion(
  scope: Pick<DataScope, "superuser" | "role" | "cabangScope" | "amOnly">,
  diminta: string | null | undefined,
  peta: Record<string, string>,
): { region: RegionSales; bolehPilih: boolean } {
  if (scope.cabangScope?.length) {
    const milik = new Set(scope.cabangScope.map((c) => peta[upper(c)]).filter((r) => r === "East" || r === "West"));
    if (milik.size === 0) throw new SalesCommandError(403, "cabang tim Anda tidak termasuk region Sales East/West");
    const pilih = [...milik] as RegionSales[];
    // HoD yang memegang dua region (jarang) boleh berpindah di antara keduanya saja.
    const r = pilih.includes(diminta as RegionSales) ? (diminta as RegionSales) : pilih[0];
    return { region: r, bolehPilih: pilih.length > 1 };
  }
  if (scope.amOnly) throw new SalesCommandError(403, "Sales Command Center untuk HoD dan Direktur");
  const role = (scope.role ?? "").toLowerCase();
  if (!scope.superuser && role !== "direktur" && role !== "admin") {
    throw new SalesCommandError(403, "Sales Command Center untuk HoD dan Direktur");
  }
  if (diminta && !REGION_SALES.includes(diminta as RegionSales)) {
    throw new SalesCommandError(400, "region harus East atau West");
  }
  return { region: (diminta as RegionSales) || "East", bolehPilih: true };
}

export interface BarisAm {
  am_id: string;
  nama: string;
  cabang: string | null;
  /** Lampu AM Radar (capaian YTD vs target tahunan): green/yellow/red/na. */
  lampu: string;
  capaian_pct: number | null;
  /** Status pacing YTD targetPacing: on-track / at-risk / behind / n/a. */
  pacing: string;
  proyeksi_pct: number | null;
  plan_report_miss: number;
  plan_report_expected: number;
  deal_dormant: number;
  deal_macet: number;
  pipeline_meragukan: number;
  ar_90: number;
  /** Jumlah sinyal merah — dasar urutan "perlu perhatian". Tanpa lampu YTD (lihat gabungPerAm). */
  skor: number;
}

interface SumberAm {
  radar: { am_id: string; nama: string; cabang: string | null; light: string; achievement_pct: number | null }[];
  pacing: { am_id: string; nama: string; cabang: string | null; status: string; projected_pct: number | null }[];
  compliance: { am_id: string; nama: string; cabang: string | null; expected: number; miss: number }[];
  deals: { am_id: string | null; dormant: boolean; stale: boolean }[];
  /** keaslian & AR berlabel NAMA AM, bukan am_id — dipetakan lewat namaKeAm. */
  meragukanPerNama: Map<string, number>;
  ar90PerNama: Map<string, number>;
  namaKeAm: Map<string, string>;
}

/** Murni: gabungkan sinyal per AM, urut dari yang paling butuh perhatian. */
export function gabungPerAm(s: SumberAm): BarisAm[] {
  const m = new Map<string, BarisAm>();
  const ambil = (am_id: string, nama: string, cabang: string | null): BarisAm => {
    let b = m.get(am_id);
    if (!b) {
      b = { am_id, nama, cabang, lampu: "na", capaian_pct: null, pacing: "n/a", proyeksi_pct: null,
        plan_report_miss: 0, plan_report_expected: 0, deal_dormant: 0, deal_macet: 0, pipeline_meragukan: 0, ar_90: 0, skor: 0 };
      m.set(am_id, b);
    }
    return b;
  };
  for (const r of s.radar) { const b = ambil(r.am_id, r.nama, r.cabang); b.lampu = r.light; b.capaian_pct = r.achievement_pct; }
  for (const r of s.pacing) { const b = ambil(r.am_id, r.nama, r.cabang); b.pacing = r.status; b.proyeksi_pct = r.projected_pct; }
  for (const r of s.compliance) { const b = ambil(r.am_id, r.nama, r.cabang); b.plan_report_miss = r.miss; b.plan_report_expected = r.expected; }
  for (const d of s.deals) {
    if (!d.am_id || !m.has(d.am_id)) continue;
    const b = m.get(d.am_id)!;
    if (d.dormant) b.deal_dormant += 1;
    else if (d.stale) b.deal_macet += 1;
  }
  for (const [nama, n] of s.meragukanPerNama) { const id = s.namaKeAm.get(upper(nama)); if (id && m.has(id)) m.get(id)!.pipeline_meragukan += n; }
  for (const [nama, v] of s.ar90PerNama) { const id = s.namaKeAm.get(upper(nama)); if (id && m.has(id)) m.get(id)!.ar_90 += v; }
  for (const b of m.values()) {
    // Lampu YTD SENGAJA tak dihitung: ia membandingkan penjualan sejak 1 Januari dengan
    // target SETAHUN penuh (tak diprorata), jadi di awal tahun hampir semua AM merah dan
    // urutan jadi tumpul. Kinerja diwakili pacing tahun (sudah diprorata) — keputusan
    // pemilik 4 Nov 2026. Lampu tetap tampil sebagai informasi.
    b.skor = (b.pacing === "behind" ? 1 : 0) + (b.plan_report_miss > 0 ? 1 : 0)
      + (b.deal_dormant > 0 ? 1 : 0) + (b.pipeline_meragukan > 0 ? 1 : 0) + (b.ar_90 > 0 ? 1 : 0);
  }
  return [...m.values()].sort((a, b) => b.skor - a.skor || b.ar_90 - a.ar_90 || a.nama.localeCompare(b.nama));
}

const senin = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const hari = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - hari);
  return d.toISOString().slice(0, 10);
};
export type MasalahData = "bulan_lewat" | "tanpa_bulan" | "tanpa_nilai";
export interface DealKualitas {
  deal_id: string; am_id: string | null; am: string | null; faskes: string; stage: string;
  purchase_month: number | null; purchase_year: number | null; nilai: number | null;
}

/**
 * Murni: kualitas data deal TERBUKA untuk forecast (Fase B ditunda sampai layak —
 * keputusan pemilik 4 Nov 2026: cek prod 75% estimasi bulan beli sudah lewat).
 * bulan_lewat = estimasi bulan beli sebelum bulan berjalan; tanpa_bulan = bulan/tahun
 * kosong; tanpa_nilai = nilai deal kosong/nol. `bulanIni` = "YYYY-MM".
 */
export function kualitasDataPipeline(deals: DealKualitas[], bulanIni: string) {
  const [yy, mm] = bulanIni.split("-").map(Number);
  const kini = yy * 12 + (mm - 1);
  const perAm = new Map<string, { am_id: string | null; nama: string; terbuka: number; bulan_lewat: number; tanpa_bulan: number; tanpa_nilai: number }>();
  const bermasalah: (DealKualitas & { masalah: MasalahData[] })[] = [];
  let lewat = 0, kosong = 0, nol = 0;
  for (const d of deals) {
    const masalah: MasalahData[] = [];
    if (d.purchase_month == null || d.purchase_year == null) masalah.push("tanpa_bulan");
    else if (d.purchase_year * 12 + (d.purchase_month - 1) < kini) masalah.push("bulan_lewat");
    if (!(Number(d.nilai) > 0)) masalah.push("tanpa_nilai");
    const k = d.am_id ?? "(tanpa AM)";
    const a = perAm.get(k) ?? { am_id: d.am_id, nama: d.am ?? d.am_id ?? "(tanpa AM)", terbuka: 0, bulan_lewat: 0, tanpa_bulan: 0, tanpa_nilai: 0 };
    a.terbuka += 1;
    for (const m of masalah) a[m] += 1;
    perAm.set(k, a);
    if (masalah.includes("bulan_lewat")) lewat += 1;
    if (masalah.includes("tanpa_bulan")) kosong += 1;
    if (masalah.includes("tanpa_nilai")) nol += 1;
    if (masalah.length) bermasalah.push({ ...d, masalah });
  }
  const skor = (a: { bulan_lewat: number; tanpa_bulan: number; tanpa_nilai: number }) => a.bulan_lewat + a.tanpa_bulan + a.tanpa_nilai;
  return {
    terbuka: deals.length, bulan_lewat: lewat, tanpa_bulan: kosong, tanpa_nilai: nol,
    per_am: [...perAm.values()].filter((a) => skor(a) > 0).sort((a, b) => skor(b) - skor(a) || a.nama.localeCompare(b.nama)),
    deals: bermasalah
      .sort((a, b) => (a.am ?? "").localeCompare(b.am ?? "") || (Number(b.nilai) || 0) - (Number(a.nilai) || 0))
      .slice(0, 150),
  };
}

const hariIniWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export async function salesCommand(scope: DataScope, regionDiminta: string | null) {
  const sql = db();
  const peta = Object.fromEntries(Object.entries(await cabangRegionMap(sql)).map(([c, r]) => [upper(c), r]));
  const { region, bolehPilih } = tentukanRegion(scope, regionDiminta, peta);
  const cabang = Object.entries(peta).filter(([, r]) => r === region).map(([c]) => c);
  // Scope region: bentuknya sama dengan scope HoD yang dibangun resolveScope, jadi
  // semua fungsi sumber menyaring persis seperti saat HoD membuka menu asalnya.
  const sc: DataScope = { ...FULL_SCOPE, userId: scope.userId, cabangScope: cabang, role: scope.role ?? null };
  const tgl = hariIniWib();
  const dariSenin = senin(tgl);

  const [soPacing, pacing, radar, compliance, pipe, keaslian, ar, alerts, roster] = await Promise.all([
    getSoPacing(),
    targetPacing(undefined, sc),
    execAmRadar(sc),
    reportCompliance(dariSenin, tgl),
    getPipeline(sc),
    keaslianPipeline(sc),
    arAgingByCustomer(sc),
    scope.userId ? listAlerts(String(scope.userId)) : Promise.resolve([]),
    sql<{ am_id: string; nama: string | null; panggilan: string | null; cabang: string | null }[]>`
      SELECT am_id, nama, panggilan, cabang FROM master_user WHERE aktif IS NOT FALSE`,
  ]);

  const diRegion = (c: string | null | undefined) => !!c && cabang.includes(upper(c));
  const namaKeAm = new Map<string, string>();
  for (const r of roster) {
    if (r.nama) namaKeAm.set(upper(r.nama), r.am_id);
    if (r.panggilan) namaKeAm.set(upper(r.panggilan), r.am_id);
  }
  const meragukanPerNama = new Map(keaslian.per_am.map((p) => [String(p.am), Number(p.meragukan) || 0]));
  const ar90PerNama = new Map<string, number>();
  for (const c of ar.customers) {
    if (!c.am || !(Number(c.b90plus) > 0)) continue;
    ar90PerNama.set(c.am, (ar90PerNama.get(c.am) ?? 0) + Number(c.b90plus));
  }
  const deals = pipe.stages.flatMap((s) => s.deals).filter((d) => d.opsi_utama);

  const perAm = gabungPerAm({
    // Baris tanpa am_id (OFFICE/VACANT) bukan AM yang bisa dibina — dilewati.
    radar: radar.rows.filter((r) => r.am_id && diRegion(r.cabang)).map((r) => ({
      am_id: String(r.am_id), nama: r.nama ?? String(r.am_id), cabang: r.cabang, light: r.light, achievement_pct: r.achievement_pct ?? null })),
    pacing: pacing.am.map((r) => ({ am_id: r.am_id, nama: r.nama, cabang: r.cabang, status: r.status, projected_pct: r.projected_pct ?? null })),
    compliance: compliance.rows.filter((r) => diRegion(r.cabang)).map((r) => ({
      am_id: r.am_id, nama: r.nama, cabang: r.cabang, expected: r.expected, miss: r.miss })),
    deals: deals.map((d) => ({ am_id: d.am_id, dormant: d.dormant, stale: d.stale })),
    meragukanPerNama, ar90PerNama, namaKeAm,
  });

  const rp = soPacing.regions.find((r) => r.region === region) ?? null;
  const dormant = deals.filter((d) => d.dormant)
    .sort((a, b) => (a.gugur_at ?? "").localeCompare(b.gugur_at ?? ""))
    .slice(0, 10)
    .map((d) => ({ deal_id: d.deal_id, faskes: d.facility_name || d.customer_name, am: d.am_name ?? d.am_id,
      stage: d.stage, nilai: d.estimate_amount, gugur_at: d.gugur_at, days_idle: d.days_idle }));

  return {
    region,
    regions: bolehPilih ? (scope.cabangScope?.length ? [...new Set(scope.cabangScope.map((c) => peta[upper(c)]))] : REGION_SALES) : [region],
    tanggal: tgl,
    minggu_dari: dariSenin,
    cabang,
    so_pacing: rp && { ...rp, ambang: soPacing.ambang, hari_kerja_lewat: soPacing.hari_kerja_lewat, hari_kerja_bulan: soPacing.hari_kerja_bulan },
    ytd: { ...pacing.summary.am, elapsed_pct: pacing.elapsed_pct },
    lampu: {
      green: perAm.filter((b) => b.lampu === "green").length,
      yellow: perAm.filter((b) => b.lampu === "yellow").length,
      red: perAm.filter((b) => b.lampu === "red").length,
    },
    plan_report: {
      am_miss: perAm.filter((b) => b.plan_report_miss > 0).length,
      miss: perAm.reduce((a, b) => a + b.plan_report_miss, 0),
      expected: perAm.reduce((a, b) => a + b.plan_report_expected, 0),
    },
    pipeline: {
      total_value: pipe.summary.total_value,
      weighted_value: pipe.summary.weighted_value,
      dormant: deals.filter((d) => d.dormant).length,
      macet: deals.filter((d) => !d.dormant && d.stale).length,
      meragukan: keaslian.ringkas.meragukan,
      nilai_meragukan: keaslian.ringkas.nilai_meragukan,
    },
    ar: {
      outstanding: ar.summary.total_outstanding,
      lewat_90: ar.summary.buckets["90+"] ?? 0,
      kritis: ar.summary.kritis,
    },
    per_am: perAm,
    kualitas_data: kualitasDataPipeline(
      deals.filter((d) => d.stage !== "Closing-Won" && d.stage !== "Closing-Lost").map((d) => ({
        deal_id: d.deal_id, am_id: d.am_id, am: d.am_name ?? d.am_id, faskes: d.facility_name || d.customer_name,
        stage: d.stage, purchase_month: d.purchase_month, purchase_year: d.purchase_year, nilai: d.estimate_amount })),
      tgl.slice(0, 7),
    ),
    dormant_teratas: dormant,
    alert_aktif: alerts.filter((a) => a.active && a.last_state === "breach")
      .map((a) => ({ id: a.id, nama: a.alert_name, metrik: a.metric_key })),
  };
}

// ---------------------------------------------------------------- rekap WA mingguan ke HoD

// Kartu Kualitas data pipeline (4 Nov) tak menggerakkan data: cek prod 7 Nov, 0 deal
// terbuka diubah sejak kartu live, 77% (East) / 71% (West) estimasi bulan beli sudah
// lewat. Keputusan user 7 Nov: rekap WA mingguan ke HoD tiap region — daftar AM dan
// jumlah deal yang perlu diperbarui. Penerima = HoD pemilik cabang region di
// hod_territory → waHod (tak ada nama orang di kode). Saklar SCC_KUALITAS_REKAP_ENABLED
// (default mati); sekali per minggu ISO per region (notif_state).

export const REKAP_MAKS_AM = 12;

/** Teks rekap per region (murni, diuji). */
export function buildRekapKualitas(region: RegionSales, k: ReturnType<typeof kualitasDataPipeline>, maks = REKAP_MAKS_AM): string {
  const pct = (n: number) => (k.terbuka ? Math.round((n / k.terbuka) * 100) : 0);
  const am = k.per_am.slice(0, maks).map((a, i) => {
    const bagian = [a.bulan_lewat && `${a.bulan_lewat} bulan beli lewat`, a.tanpa_bulan && `${a.tanpa_bulan} bulan beli kosong`, a.tanpa_nilai && `${a.tanpa_nilai} tanpa nilai`].filter(Boolean);
    return `${i + 1}. ${a.nama} — ${bagian.join(" · ")} (dari ${a.terbuka} deal)`;
  });
  return [
    `📋 *Kualitas data pipeline — Sales ${region}*`,
    `${k.terbuka} deal terbuka: ${k.bulan_lewat} bulan beli sudah lewat (${pct(k.bulan_lewat)}%), ${k.tanpa_bulan} bulan beli kosong, ${k.tanpa_nilai} tanpa nilai.`,
    "",
    "AM yang perlu memperbarui deal-nya:",
    ...am,
    ...(k.per_am.length > maks ? [`… dan ${k.per_am.length - maks} AM lainnya.`] : []),
    "",
    "Minta AM membuka deal-nya di Pipeline → Edit → perbarui estimasi bulan beli dan nilai. Daftar deal per AM: menu Sales Command Center → kartu Kualitas data pipeline (klik deal untuk langsung membuka detailnya). Forecast penjualan per region baru bisa dibuat setelah data ini layak.",
  ].join("\n");
}

/** Kualitas data deal terbuka satu region — sumber sama dengan kartu di salesCommand(). */
export async function kualitasRegion(region: RegionSales) {
  const sql = db();
  const peta = Object.fromEntries(Object.entries(await cabangRegionMap(sql)).map(([c, r]) => [upper(c), r]));
  const cabang = Object.entries(peta).filter(([, r]) => r === region).map(([c]) => c);
  const sc: DataScope = { ...FULL_SCOPE, cabangScope: cabang };
  const pipe = await getPipeline(sc);
  const deals = pipe.stages.flatMap((s) => s.deals)
    .filter((d) => d.opsi_utama && d.stage !== "Closing-Won" && d.stage !== "Closing-Lost");
  const k = kualitasDataPipeline(deals.map((d) => ({
    deal_id: d.deal_id, am_id: d.am_id, am: d.am_name ?? d.am_id, faskes: d.facility_name || d.customer_name,
    stage: d.stage, purchase_month: d.purchase_month, purchase_year: d.purchase_year, nilai: d.estimate_amount })),
  hariIniWib().slice(0, 7));
  const hod = await sql<{ hod_key: string }[]>`
    SELECT DISTINCT hod_key FROM hod_territory WHERE upper(btrim(cabang)) = ANY(${cabang}::text[]) ORDER BY hod_key`;
  return { k, cabang, hod_keys: hod.map((h) => String(h.hod_key)) };
}

export interface RekapKualitasRegion { region: RegionSales; masalah: number; penerima: string[]; sent: boolean; skipped?: string; error?: string; payload?: string }

export async function runRekapKualitas(opts: { dryRun?: boolean; region?: RegionSales } = {}): Promise<{ week: string; dryRun: boolean; regions: RekapKualitasRegion[] }> {
  const sql = db();
  const today = hariIniWib();
  const week = isoWeek(today);
  const out: RekapKualitasRegion[] = [];
  for (const region of opts.region ? [opts.region] : REGION_SALES) {
    const key = `scc-kualitas-rekap:${region}:${week}`;
    if (!opts.dryRun) {
      const [done] = await sql`SELECT 1 FROM notif_state WHERE key = ${key}`;
      if (done) { out.push({ region, masalah: 0, penerima: [], sent: false, skipped: `sudah terkirim minggu ${week}` }); continue; }
    }
    const { k, hod_keys } = await kualitasRegion(region);
    const masalah = k.bulan_lewat + k.tanpa_bulan + k.tanpa_nilai;
    if (!masalah) { out.push({ region, masalah, penerima: [], sent: false, skipped: "tak ada deal bermasalah" }); continue; }
    const text = buildRekapKualitas(region, k);
    const tujuan = (await Promise.all(hod_keys.map((h) => waHod(h)))).filter((x): x is { nama: string; wa: string } => !!x);
    if (opts.dryRun) { out.push({ region, masalah, penerima: tujuan.map((t) => t.nama), sent: false, payload: text }); continue; }
    if (!tujuan.length) { out.push({ region, masalah, penerima: [], sent: false, skipped: "nomor WA HoD region tak ditemukan" }); continue; }
    let terkirim = false; let error: string | undefined;
    for (const t of tujuan) {
      const w = await sendViaWaGateway(t.wa, text);
      if (w.sent && !w.stub && !w.dryRun) terkirim = true; // stub & dry-run gateway juga sent=true
      if (w.error) error = w.error;
    }
    if (terkirim) {
      await sql`INSERT INTO notif_state (key, signature, count, sent_at) VALUES (${key}, ${today}, 1, now())
        ON CONFLICT (key) DO UPDATE SET signature = EXCLUDED.signature, count = notif_state.count + 1, sent_at = now()`;
    }
    out.push({ region, masalah, penerima: tujuan.map((t) => t.nama), sent: terkirim, error });
  }
  return { week, dryRun: Boolean(opts.dryRun), regions: out };
}

/** Region yang boleh dilihat pemanggil (aturan sama dengan salesCommand). */
export async function regionUntukScope(scope: DataScope, diminta: string | null): Promise<RegionSales> {
  const peta = Object.fromEntries(Object.entries(await cabangRegionMap(db())).map(([c, r]) => [upper(c), r]));
  return tentukanRegion(scope, diminta, peta).region;
}
