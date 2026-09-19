import { db } from "../db.js";
import { joinAmFromSalesman } from "./salesman-am.js";
import { reportCompliance } from "./plandash.js";

// Mengisi `kpi_measurement` DARI DATA OPERASIONAL yang sudah ada, bukan dari
// input manual.
//
// Latar: 194 KPI di spine karyawan, hanya 13 yang pernah punya baris pengukuran
// — dan 18 baris itu seluruhnya seed 10 Juli 2026 (achievement 100, `actual`
// kosong). Akibatnya skor BSC di Raport Karyawan 360 praktis mati.
//
// BATAS YANG DISENGAJA: modul ini HANYA mengisi KPI yang punya sumber data
// tak-ambigu di sistem ini. Sisanya dibiarkan kosong dan dilaporkan sebagai
// `tanpa_sumber`, lengkap dengan alasannya. Menebak angka untuk "Trouble alat
// pasca-maintenance" atau "Kehadiran Zoom report pagi" hanya akan memindahkan
// kebohongan seed ke tempat baru — kali ini dengan tampilan resmi.
//
// Pencocokan KPI → metrik memakai DAFTAR EKSPLISIT di bawah (regex atas nama
// KPI + dept), bukan skor kemiripan. Pelajaran dari pemetaan posisi↔karyawan:
// fuzzy matching menghasilkan pasangan yang terlihat masuk akal dan salah.

export type MetrikKey =
  | "kunjungan_per_hari"
  | "realisasi_plan"
  | "kepatuhan_plan_report"
  | "revenue_vs_target"
  | "revenue_vs_bulan_lalu"
  | "customer_baru"
  | "prospek_per_minggu";

type TargetKind = "per_hari" | "per_minggu" | "per_bulan" | "persen" | "implisit";

interface Aturan {
  /** Nama KPI harus cocok penuh (case-insensitive) — bukan "mengandung". */
  re: RegExp;
  dept: string[];
  metrik: MetrikKey;
  target: TargetKind;
  /** Dipakai saat teks target tak memuat angka (mis. "sesuai plan bulanan"). */
  targetDefault?: number;
  satuan: string;
}

// Satu baris = satu janji: "KPI bernama X di dept Y diukur dengan metrik Z".
// Menambah baris di sini adalah keputusan sadar, dan itu memang maksudnya.
const ATURAN: Aturan[] = [
  { re: /^jumlah kunjungan customer$|^jumlah visit customer$/i, dept: ["sales"], metrik: "kunjungan_per_hari", target: "per_hari", satuan: "kunjungan/hari kerja" },
  { re: /^realisasi vs plan kunjungan$/i, dept: ["sales"], metrik: "realisasi_plan", target: "persen", targetDefault: 100, satuan: "%" },
  { re: /^kepatuhan plan-?report( wa)?$/i, dept: ["sales"], metrik: "kepatuhan_plan_report", target: "persen", targetDefault: 100, satuan: "%" },
  { re: /^revenue area$/i, dept: ["sales"], metrik: "revenue_vs_target", target: "implisit", satuan: "Rp (netto)" },
  { re: /^(omset area|omzet bulanan|value penjualan|nilai closing \/ revenue|kestabilan omset area)$/i, dept: ["sales"], metrik: "revenue_vs_bulan_lalu", target: "implisit", satuan: "Rp (netto)" },
  { re: /^(customer baru aktif|new customer|customer baru)$/i, dept: ["sales"], metrik: "customer_baru", target: "per_bulan", satuan: "customer baru" },
  { re: /^prospek mingguan$/i, dept: ["sales"], metrik: "prospek_per_minggu", target: "per_minggu", satuan: "prospek/minggu" },
];

export interface BarisUkur {
  kpi_id: number; kpi: string; karyawan: string; am_id: string | null; dept: string | null;
  metrik: MetrikKey; target_teks: string | null;
  actual_num: number | null; target_num: number | null;
  actual: string; achievement_pct: number | null; note: string;
}
export interface BarisTanpaSumber {
  kpi_id: number; kpi: string; karyawan: string; dept: string | null; target_teks: string | null; alasan: string;
}
export interface HasilUkur {
  period: string; from: string; to: string; hari_kerja: number; minggu: number;
  /** true = periode masih berjalan; target akumulatif dipro-rata (lihat catatan di bawah). */
  berjalan: boolean; hari_kerja_bulan: number;
  terisi: BarisUkur[]; tanpa_sumber: BarisTanpaSumber[];
  ringkas: { kpi_total: number; terukur: number; tanpa_sumber: number; ditulis: number };
}

const bulanBatas = (period: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`period harus YYYY-MM, dapat: ${period}`);
  const y = Number(m[1]), mo = Number(m[2]);
  const from = `${m[1]}-${m[2]}-01`;
  const akhir = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from, to: `${m[1]}-${m[2]}-${String(akhir).padStart(2, "0")}` };
};
const bulanSebelum = (period: string) => {
  const [y, mo] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/**
 * Angka target dari teks bebas yang ditulis PIC ("~4–6 / hari", "≥95%",
 * "~6 / tahun"). Rentang diambil BATAS BAWAHNYA: "4–6 kunjungan" berarti 4
 * sudah memenuhi janji, dan memakai 6 akan menghukum orang yang menepatinya.
 * Periode disetarakan ke satuan metriknya (tahun → /12, kuartal → /3).
 */
export function parseTarget(teks: string | null, kind: TargetKind, fallback?: number): number | null {
  if (kind === "implisit") return null;
  const t = (teks ?? "").toLowerCase();
  const angka = t.match(/\d+(?:[.,]\d+)?/);
  if (!angka) return fallback ?? null;
  let n = Number(angka[0].replace(",", "."));
  if (!Number.isFinite(n)) return fallback ?? null;
  if (kind === "per_bulan") {
    if (/tahun/.test(t)) n /= 12;
    else if (/kuartal|triwulan/.test(t)) n /= 3;
  }
  return n;
}

const rp = (n: number) => "Rp " + new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(Math.round(n));
const bulat1 = (n: number) => Math.round(n * 10) / 10;

/** Tanggal WIB hari ini (YYYY-MM-DD) — batas atas periode yang masih berjalan. */
const hariIniWib = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export async function hitungKpiBulan(period: string): Promise<HasilUkur> {
  const sql = db();
  const batas = bulanBatas(period);
  const from = batas.from;
  // PERIODE BERJALAN DIPOTONG DI HARI INI, dan target akumulatif (revenue,
  // customer baru) dipro-rata sebanyak hari kerja yang sudah lewat.
  // Tanpa ini, job harian yang menyegarkan bulan berjalan akan melaporkan
  // "26% dari target" pada tanggal 5 — bukan temuan kinerja, cuma bulan yang
  // belum selesai. Metrik yang sudah berupa LAJU (kunjungan/hari, %, prospek/
  // minggu) tidak ikut dipro-rata: pembaginya memang sudah ikut mengecil.
  const hariIni = hariIniWib();
  const berjalan = hariIni >= from && hariIni < batas.to;
  const to = berjalan ? hariIni : batas.to;
  const lalu = bulanBatas(bulanSebelum(period));

  const hariKerjaSql = (a: string, b: string) => sql`
      SELECT count(*)::int AS n FROM generate_series(${a}::date, ${b}::date, '1 day') g(d)
       WHERE EXTRACT(DOW FROM g.d) NOT IN (0,6)
         AND NOT EXISTS (SELECT 1 FROM master_holiday h WHERE h.tanggal = g.d::date)`;

  const [[hk], [hkBulan], planRows, revRows, revLaluRows, targetRows, baruRows, dealRows, komplians, kpiRows] = await Promise.all([
    hariKerjaSql(from, to),
    hariKerjaSql(from, batas.to),
    sql`
      SELECT am_id, count(*)::int AS plan, count(*) FILTER (WHERE reported)::int AS reported
        FROM sales_plan WHERE tanggal BETWEEN ${from} AND ${to} GROUP BY am_id`,
    sql`
      SELECT mu.am_id, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS netto
        FROM accurate_invoice ai
        JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        ${joinAmFromSalesman(sql)}
       WHERE ai.tanggal BETWEEN ${from} AND ${to} AND mu.am_id IS NOT NULL
       GROUP BY mu.am_id`,
    sql`
      SELECT mu.am_id, sum(ai.total - COALESCE(ai.tax_amount,0))::float8 AS netto
        FROM accurate_invoice ai
        JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        ${joinAmFromSalesman(sql)}
       WHERE ai.tanggal BETWEEN ${lalu.from} AND ${lalu.to} AND mu.am_id IS NOT NULL
       GROUP BY mu.am_id`,
    sql`SELECT am_id, target::float8 AS target FROM sales_target_am WHERE year = ${Number(period.slice(0, 4))}`,
    // "Customer baru" = faktur PERTAMA customer itu (sepanjang riwayat mirror)
    // jatuh di bulan ini. Bukan "customer yang bertransaksi bulan ini".
    sql`
      WITH pertama AS (
        SELECT customer_id, min(tanggal) AS tgl FROM accurate_invoice GROUP BY customer_id
      )
      SELECT mu.am_id, count(DISTINCT ai.customer_id)::int AS n
        FROM pertama p
        JOIN accurate_invoice ai ON ai.customer_id = p.customer_id AND ai.tanggal = p.tgl
        JOIN accurate_salesman acs ON acs.id = ai.salesman_id
        ${joinAmFromSalesman(sql)}
       WHERE p.tgl BETWEEN ${from} AND ${to} AND mu.am_id IS NOT NULL
       GROUP BY mu.am_id`,
    sql`
      SELECT am_id, count(*)::int AS n FROM deal
       WHERE created_at >= ${from}::date AND created_at < (${to}::date + 1) AND am_id IS NOT NULL
       GROUP BY am_id`,
    reportCompliance(from, to),
    sql`
      SELECT k.id::int AS kpi_id, k.name, k.target, k.lower_better, e.nama, e.dept, e.am_id
        FROM kpi k JOIN employee e ON e.id = k.employee_id
       ORDER BY e.nama, k.seq`,
  ]);

  const hariKerja = Number(hk?.n ?? 0);
  const hariKerjaBulan = Math.max(1, Number(hkBulan?.n ?? 0));
  const minggu = Math.max(1, Math.round(hariKerja / 5));
  /** Porsi bulan yang sudah berjalan — 1 untuk bulan yang sudah lewat. */
  const porsi = berjalan ? Math.min(1, hariKerja / hariKerjaBulan) : 1;
  const catatanProrata = berjalan
    ? ` · periode berjalan: target dipro-rata ${hariKerja}/${hariKerjaBulan} hari kerja`
    : "";
  const num = (v: unknown) => (v == null ? 0 : Number(v));
  const plan = new Map(planRows.map((r) => [String(r.am_id), { plan: num(r.plan), reported: num(r.reported) }]));
  const rev = new Map(revRows.map((r) => [String(r.am_id), num(r.netto)]));
  const revLalu = new Map(revLaluRows.map((r) => [String(r.am_id), num(r.netto)]));
  const targetTahun = new Map(targetRows.map((r) => [String(r.am_id), num(r.target)]));
  const baru = new Map(baruRows.map((r) => [String(r.am_id), num(r.n)]));
  const deal = new Map(dealRows.map((r) => [String(r.am_id), num(r.n)]));
  const komp = new Map(komplians.rows.map((r) => [r.am_id, r.compliance_rate]));

  const terisi: BarisUkur[] = [];
  const tanpaSumber: BarisTanpaSumber[] = [];

  for (const k of kpiRows) {
    const kpiId = Number(k.kpi_id);
    const nama = String(k.name);
    const dept = k.dept ? String(k.dept) : null;
    const amId = k.am_id ? String(k.am_id) : null;
    const targetTeks = k.target ? String(k.target) : null;
    const lowerBetter = k.lower_better === true;
    const dasar: BarisTanpaSumber = { kpi_id: kpiId, kpi: nama, karyawan: String(k.nama), dept, target_teks: targetTeks, alasan: "" };

    const aturan = ATURAN.find((a) => a.re.test(nama.trim()) && (!dept || a.dept.includes(dept)));
    if (!aturan) { tanpaSumber.push({ ...dasar, alasan: "belum ada metrik otomatis untuk KPI ini" }); continue; }
    if (!amId) { tanpaSumber.push({ ...dasar, alasan: "karyawan belum tertaut am_id — metrik operasional berbasis am_id" }); continue; }

    let actual: number | null = null;
    let target: number | null = parseTarget(targetTeks, aturan.target, aturan.targetDefault);
    let teksActual = "";
    let note = "";

    switch (aturan.metrik) {
      case "kunjungan_per_hari": {
        const p = plan.get(amId);
        if (!p || hariKerja === 0) { tanpaSumber.push({ ...dasar, alasan: "tak ada baris sales_plan di periode ini" }); continue; }
        actual = p.reported / hariKerja;
        teksActual = `${bulat1(actual)} kunjungan/hari kerja (${p.reported} terlapor ÷ ${hariKerja} hari)`;
        note = `sumber: sales_plan.reported ${from}..${to}; hari kerja = weekday − master_holiday`;
        break;
      }
      case "realisasi_plan": {
        const p = plan.get(amId);
        if (!p || p.plan === 0) { tanpaSumber.push({ ...dasar, alasan: "tak ada rencana kunjungan di periode ini" }); continue; }
        actual = (p.reported / p.plan) * 100;
        teksActual = `${bulat1(actual)}% (${p.reported} dari ${p.plan} rencana)`;
        note = `sumber: sales_plan ${from}..${to}`;
        break;
      }
      case "kepatuhan_plan_report": {
        const c = komp.get(amId);
        if (c == null) { tanpaSumber.push({ ...dasar, alasan: "tak ada baris kepatuhan (bukan wajib plan-report / cuti penuh)" }); continue; }
        actual = c;
        teksActual = `${bulat1(c)}% hari tepat waktu`;
        note = `sumber: reportCompliance ${from}..${to} (sama dengan yang dipakai Raport)`;
        break;
      }
      case "revenue_vs_target": {
        const r = rev.get(amId) ?? 0;
        const th = targetTahun.get(amId);
        if (!th) { tanpaSumber.push({ ...dasar, alasan: "target tahunan AM belum diisi di sales_target_am" }); continue; }
        actual = r; target = (th / 12) * porsi;
        teksActual = `${rp(r)} netto (target ${berjalan ? "s/d hari ini" : "bulan"} ${rp(target)})`;
        note = `sumber: accurate_invoice netto (total − pajak) ${from}..${to}; target = sales_target_am/12${catatanProrata}`;
        break;
      }
      case "revenue_vs_bulan_lalu": {
        const r = rev.get(amId) ?? 0;
        const rl = revLalu.get(amId);
        if (!rl) { tanpaSumber.push({ ...dasar, alasan: `tak ada revenue bulan pembanding (${bulanSebelum(period)})` }); continue; }
        actual = r; target = rl * porsi;
        teksActual = `${rp(r)} netto (bulan lalu ${rp(rl)}${berjalan ? `, pembanding pro-rata ${rp(target)}` : ""})`;
        note = `target "naik/stabil" diterjemahkan sebagai ≥ revenue ${bulanSebelum(period)}; sumber: accurate_invoice netto${catatanProrata}`;
        break;
      }
      case "customer_baru": {
        if (target == null) { tanpaSumber.push({ ...dasar, alasan: `target tak memuat angka ("${targetTeks ?? ""}")` }); continue; }
        actual = baru.get(amId) ?? 0;
        target = target * porsi;
        teksActual = `${actual} customer baru (target ${bulat1(target)}${berjalan ? " s/d hari ini" : "/bulan"})`;
        note = `customer baru = faktur PERTAMA customer jatuh di ${from}..${to}; sumber: accurate_invoice${catatanProrata}`;
        break;
      }
      case "prospek_per_minggu": {
        if (target == null) { tanpaSumber.push({ ...dasar, alasan: `target tak memuat angka ("${targetTeks ?? ""}")` }); continue; }
        actual = (deal.get(amId) ?? 0) / minggu;
        teksActual = `${bulat1(actual)} prospek/minggu (${deal.get(amId) ?? 0} deal ÷ ${minggu} minggu)`;
        note = `sumber: deal.created_at ${from}..${to}; minggu = hari kerja/5`;
        break;
      }
    }

    if (actual == null || target == null || target === 0) {
      tanpaSumber.push({ ...dasar, alasan: "target nol / tak terhitung" });
      continue;
    }
    // lower_better: capaian = target/actual (makin kecil actual makin baik).
    const pct = lowerBetter ? (actual === 0 ? 120 : (target / actual) * 100) : (actual / target) * 100;
    terisi.push({
      kpi_id: kpiId, kpi: nama, karyawan: String(k.nama), am_id: amId, dept,
      metrik: aturan.metrik, target_teks: targetTeks,
      actual_num: bulat1(actual), target_num: bulat1(target),
      actual: teksActual, achievement_pct: bulat1(Math.max(0, pct)), note,
    });
  }

  return {
    period, from, to, hari_kerja: hariKerja, minggu,
    berjalan, hari_kerja_bulan: hariKerjaBulan,
    terisi, tanpa_sumber: tanpaSumber,
    ringkas: {
      kpi_total: kpiRows.length, terukur: terisi.length,
      tanpa_sumber: tanpaSumber.length, ditulis: 0,
    },
  };
}

/**
 * Tulis hasil hitung ke `kpi_measurement` (upsert per kpi_id+period).
 *
 * TIDAK MENYENTUH baris yang tak dihitung — termasuk 18 baris seed lama. Kalau
 * suatu KPI kehilangan sumbernya bulan ini, angkanya bulan lalu dibiarkan apa
 * adanya, bukan dihapus diam-diam.
 */
export async function terapkanKpiBulan(period: string): Promise<HasilUkur> {
  const hasil = await hitungKpiBulan(period);
  if (!hasil.terisi.length) return hasil;
  const sql = db();
  await sql.begin(async (tx) => {
    for (const b of hasil.terisi) {
      await tx`
        INSERT INTO kpi_measurement (kpi_id, period, achievement_pct, actual, note, updated_at)
        VALUES (${b.kpi_id}, ${period}, ${b.achievement_pct}, ${b.actual}, ${b.note}, now())
        ON CONFLICT (kpi_id, period) DO UPDATE SET
          achievement_pct = EXCLUDED.achievement_pct,
          actual = EXCLUDED.actual,
          note = EXCLUDED.note,
          updated_at = now()`;
    }
  });
  hasil.ringkas.ditulis = hasil.terisi.length;
  return hasil;
}
