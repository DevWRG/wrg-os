// F96 — Cohort & Lead Source Analytics (dashboard saja, hanya baca, tanpa migrasi).
//
// Dua tampilan di menu /kohort:
//   1. Retensi — kurva retensi CUSTOMER Accurate per kohort kuartal faktur pertama (Q1–Q4 satu
//      tahun). Kohort = kuartal faktur pertama customer di mirror; retensi di kuartal +k = porsi
//      customer kohort itu yang punya faktur lagi di kuartal itu. Basis: accurate_invoice.
//   2. Lead Source — pipeline `lead` (F65) per sumber × status × kuartal, plus rekap per HoD per
//      semester (kaitan NPK: tidak mengubah skor NPK, hanya memberi bahan menilai effort).
//
// Lima sumber dari Direktur (rapat 2026-10-19 + klarifikasi): Tender, Referensi customer, Vendor
// lead, Trade show, Cold call. `lead.source` (migrasi 209) tak punya nilai "vendor", jadi
// Vendor lead selalu tampil 0 sampai ada nilainya; wa/web/lainnya → baris "Lainnya". Tanpa ubah data.

import { db } from "../db.js";

export const OFFSET_MAKS = 4; // kuartal +0 … +4 (setahun penuh)

const kuartalIdx = (iso: string): number => {
  const [y, m] = iso.split("-").map(Number);
  return y * 4 + Math.floor((m - 1) / 3);
};

const wibHariIni = (): string => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

// ── Retensi ───────────────────────────────────────────────────────────────

export interface RetensiRaw {
  /** Awal kuartal kohort (YYYY-MM-DD). */
  kohort: string;
  offset: number;
  n: number;
}

export interface Kohort {
  kuartal: 1 | 2 | 3 | 4;
  label: string;
  ukuran: number;
  /** false = kuartal ini adalah kuartal PERTAMA data mirror → memuat customer lama, bukan murni baru. */
  lengkap: boolean;
  /** Jumlah customer yang aktif di kuartal +k; null = kuartal itu belum terjadi. */
  aktif: (number | null)[];
  /** Indeks +k yang jatuh di kuartal BERJALAN (data parsial, bukan churn); null bila tak ada. */
  berjalan: number | null;
  /** aktif / ukuran × 100 (1 desimal); null bila belum terjadi atau kohort kosong. */
  persen: (number | null)[];
}

export interface RetensiResult {
  tahun: number;
  data_mulai: string | null;
  kohort: Kohort[];
}

/** Murni (diuji). `hariIni`/`dataMulai` = YYYY-MM-DD. */
export function susunRetensi(raw: RetensiRaw[], tahun: number, hariIni: string, dataMulai: string | null): RetensiResult {
  const sekarang = kuartalIdx(hariIni);
  const awalData = dataMulai ? kuartalIdx(dataMulai) : null;
  const kohort: Kohort[] = ([1, 2, 3, 4] as const).map((q) => {
    const idx = tahun * 4 + (q - 1);
    const bulan = String((q - 1) * 3 + 1).padStart(2, "0");
    const baris = raw.filter((r) => r.kohort === `${tahun}-${bulan}-01`);
    const ukuran = baris.find((r) => r.offset === 0)?.n ?? 0;
    const aktif: (number | null)[] = [];
    const persen: (number | null)[] = [];
    for (let k = 0; k <= OFFSET_MAKS; k++) {
      if (idx + k > sekarang) {
        aktif.push(null);
        persen.push(null);
        continue;
      }
      const n = baris.find((r) => r.offset === k)?.n ?? 0;
      aktif.push(n);
      persen.push(ukuran > 0 ? Math.round((n / ukuran) * 1000) / 10 : null);
    }
    const k = sekarang - idx;
    const berjalan = k >= 0 && k <= OFFSET_MAKS ? k : null;
    return { kuartal: q, label: `Q${q} ${tahun}`, ukuran, lengkap: awalData !== null && idx > awalData, aktif, berjalan, persen };
  });
  return { tahun, data_mulai: dataMulai, kohort };
}

export async function getRetensi(opts: { tahun?: number }): Promise<RetensiResult> {
  const hariIni = wibHariIni();
  const tahun = opts.tahun && opts.tahun >= 2000 && opts.tahun <= 2100 ? opts.tahun : Number(hariIni.slice(0, 4));
  const sql = db();
  // Customer "aktif" di sebuah kuartal = punya ≥1 faktur bernilai positif di kuartal itu.
  // Faktur yang sudah hilang di Accurate sudah dipindah ke arsip (migrasi 243), jadi tak ikut.
  const rows = await sql`
    WITH aktif AS (
      SELECT customer_id, date_trunc('quarter', tanggal)::date AS q
      FROM accurate_invoice
      WHERE customer_id IS NOT NULL AND total > 0
      GROUP BY 1, 2
    ),
    awal AS (SELECT customer_id, min(q) AS q0 FROM aktif GROUP BY 1)
    SELECT a.q0::text AS kohort,
           ((extract(year FROM x.q)::int * 4 + extract(quarter FROM x.q)::int)
            - (extract(year FROM a.q0)::int * 4 + extract(quarter FROM a.q0)::int)) AS "offset",
           count(*)::int AS n
    FROM awal a JOIN aktif x USING (customer_id)
    WHERE a.q0 >= ${`${tahun}-01-01`}::date AND a.q0 < ${`${tahun + 1}-01-01`}::date
    GROUP BY 1, 2
  `;
  const [mulai] = await sql`SELECT min(tanggal)::text AS d FROM accurate_invoice WHERE customer_id IS NOT NULL AND total > 0`;
  return susunRetensi(
    rows.map((r) => ({ kohort: String(r.kohort), offset: Number(r.offset), n: Number(r.n) })),
    tahun,
    hariIni,
    mulai?.d ? String(mulai.d) : null,
  );
}

// ── Lead Source ───────────────────────────────────────────────────────────

export const SUMBER = [
  { key: "tender", label: "Tender" },
  { key: "referensi", label: "Referensi customer" },
  { key: "vendor", label: "Vendor lead" },
  { key: "trade_show", label: "Trade show" },
  { key: "cold_call", label: "Cold call" },
  { key: "lainnya", label: "Lainnya" },
] as const;
export type SumberKey = (typeof SUMBER)[number]["key"];

/** lead.source (migrasi 209) → lima sumber Direktur. Tak ada nilai 'vendor' di sumber data. */
export function petaSumber(source: string): SumberKey {
  switch (source) {
    case "lpse": return "tender";
    case "referral": return "referensi";
    case "pameran": return "trade_show";
    case "telepon": return "cold_call";
    default: return "lainnya"; // wa, web, lainnya
  }
}

export const STATUS = ["baru", "dihubungi", "dikonversi", "ditolak"] as const;
export type StatusLead = (typeof STATUS)[number];

export interface SelLead {
  total: number;
  baru: number;
  dihubungi: number;
  dikonversi: number;
  ditolak: number;
  nilai: number;
}
const selKosong = (): SelLead => ({ total: 0, baru: 0, dihubungi: 0, dikonversi: 0, ditolak: 0, nilai: 0 });

export interface LeadRaw {
  /** Awal kuartal (YYYY-MM-DD). */
  q: string;
  source: string;
  status: string;
  hod: string | null;
  n: number;
  nilai: number;
}

export interface LeadSourceResult {
  tahun: number;
  /** Tanggal lead tertua di tabel (semua tahun); data lead baru terkumpul sejak F65 (13 Okt 2026). */
  data_mulai: string | null;
  sumber: { key: SumberKey; label: string; kuartal: SelLead[]; total: SelLead }[];
  /** Rekap per HoD per semester (S1 = Q1–Q2, S2 = Q3–Q4); bahan menilai effort, bukan skor NPK. */
  per_hod: { hod_key: string; semester: SelLead[]; total: SelLead }[];
}

function tambah(sel: SelLead, status: string, n: number, nilai: number): void {
  sel.total += n;
  sel.nilai += nilai;
  if ((STATUS as readonly string[]).includes(status)) sel[status as StatusLead] += n;
}

/** Murni (diuji). */
export function susunLeadSource(raw: LeadRaw[], tahun: number, dataMulai: string | null): LeadSourceResult {
  const sumber = SUMBER.map((s) => ({
    key: s.key as SumberKey,
    label: s.label as string,
    kuartal: [selKosong(), selKosong(), selKosong(), selKosong()],
    total: selKosong(),
  }));
  const hod = new Map<string, { hod_key: string; semester: SelLead[]; total: SelLead }>();
  for (const r of raw) {
    if (Number(r.q.slice(0, 4)) !== tahun) continue;
    const kuartal = Math.floor((Number(r.q.slice(5, 7)) - 1) / 3); // 0..3
    const s = sumber.find((x) => x.key === petaSumber(r.source))!;
    tambah(s.kuartal[kuartal], r.status, r.n, r.nilai);
    tambah(s.total, r.status, r.n, r.nilai);
    const kunci = r.hod?.trim() || "(tanpa HoD)";
    if (!hod.has(kunci)) hod.set(kunci, { hod_key: kunci, semester: [selKosong(), selKosong()], total: selKosong() });
    const h = hod.get(kunci)!;
    tambah(h.semester[kuartal < 2 ? 0 : 1], r.status, r.n, r.nilai);
    tambah(h.total, r.status, r.n, r.nilai);
  }
  const per_hod = [...hod.values()].sort((a, b) => b.total.total - a.total.total || a.hod_key.localeCompare(b.hod_key));
  return { tahun, data_mulai: dataMulai, sumber, per_hod };
}

export async function getLeadSource(opts: { tahun?: number }): Promise<LeadSourceResult> {
  const hariIni = wibHariIni();
  const tahun = opts.tahun && opts.tahun >= 2000 && opts.tahun <= 2100 ? opts.tahun : Number(hariIni.slice(0, 4));
  const sql = db();
  // Kuartal & tanggal dihitung di WIB (created_at timestamptz) supaya lead 00:30 WIB tanggal 1
  // tak jatuh ke kuartal sebelumnya.
  const rows = await sql`
    SELECT date_trunc('quarter', created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS q,
           source, status, NULLIF(btrim(pic_hod), '') AS hod,
           count(*)::int AS n, COALESCE(sum(estimate_amount), 0)::numeric AS nilai
    FROM lead
    WHERE created_at >= (${`${tahun}-01-01`}::date::timestamp AT TIME ZONE 'Asia/Jakarta')
      AND created_at <  (${`${tahun + 1}-01-01`}::date::timestamp AT TIME ZONE 'Asia/Jakarta')
    GROUP BY 1, 2, 3, 4
  `;
  const [mulai] = await sql`SELECT min(created_at AT TIME ZONE 'Asia/Jakarta')::date::text AS d FROM lead`;
  return susunLeadSource(
    rows.map((r) => ({
      q: String(r.q), source: String(r.source), status: String(r.status),
      hod: r.hod ? String(r.hod) : null, n: Number(r.n), nilai: Number(r.nilai),
    })),
    tahun,
    mulai?.d ? String(mulai.d) : null,
  );
}
