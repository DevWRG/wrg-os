// F48 — Product-Market Fit Scorecard (fase 1): win-rate deal pipeline per brand x region, per kuartal.
//
// Izin Direktur (15 Okt 2026): boleh MEMBACA deal dari pipeline CRM, dengan syarat berkas ini
// hanya SELECT. Karena itu berkas ini TIDAK mengimpor deal.ts / account.ts / contact.ts, tidak
// ada migrasi, tidak ada tulis ke tabel crm_* / deal, dan tidak ada LLM / WA (fase 1).
//
// Aturan:
//   - "Menang" = deal terminal `Closing-Won`; "kalah" = `Closing-Lost`. `Closing` (0.9) BUKAN terminal.
//   - Tanggal tutup = log perpindahan stage terakhir ke stage terminal (`spt_state_log`), fallback
//     `stage_entered_at`. Tak ada kolom closed_at.
//   - Deal impor pameran (`spt_state_log.changed_by = 'import-pameran'`) DIKELUARKAN dari hitungan
//     (tanggal tutupnya = tanggal impor, bukan tanggal tutup sebenarnya) dan dilaporkan terpisah.
//   - Region hanya East / West (dari hod_territory lewat cabangRegionMap). OFFICE bukan region
//     (itu label sales) → "Tanpa region".
//   - Status sel deterministik: n < 5 → DATA KURANG; win-rate ≥ portofolio + 10 poin → MENANG;
//     ≤ portofolio − 10 poin → KALAH; selain itu NETRAL. Jumlah deal (n) selalu ikut ditampilkan.
//   - Lost tanpa alasan ditampilkan apa adanya (dihitung, tidak disembunyikan).
//   - Produk (tabel Brand × produk) = isian teks bebas `deal.product`, hanya dirapikan: huruf besar,
//     spasi tunggal, awalan nama brand dibuang ("ZYBIO EXR110" → "EXR110"). Varian penulisan lain
//     ("Z50" vs "HEMATOLOGY ANALYZER 5 DIFF Z50") tetap terpisah — tak ada master yang bisa dicocokkan.

import { db } from "../db.js";
import { cabangRegionMap } from "./sales.js";
import { wibToday } from "./watchpoint-week.js";

export const MIN_DEAL = 5;
export const AMBANG_POIN = 10;
export const TANPA_BRAND = "(tanpa brand)";
export const TANPA_REGION = "Tanpa region";
export const TANPA_PRODUK = "(tanpa produk)";

export type PmfRegion = "East" | "West" | typeof TANPA_REGION;
export type PmfStatus = "MENANG" | "NETRAL" | "KALAH" | "DATA KURANG";

/** Satu deal terminal, sudah dinormalisasi dari baris DB. */
export interface DealTerminal {
  brand: string | null;
  produk?: string | null;
  region: PmfRegion;
  menang: boolean;
  impor: boolean;
  tanggal_dari_log: boolean;
  alasan_kalah: string | null;
}

export interface PmfSel {
  brand: string;
  region: PmfRegion | "Semua region";
  produk?: string; // hanya di per_produk
  won: number;
  lost: number;
  n: number;
  win_rate: number | null; // persen 0-100, null bila n = 0
  selisih_poin: number | null; // vs portofolio
  status: PmfStatus;
  lost_tanpa_alasan: number;
}

export interface PmfRingkasan {
  won: number;
  lost: number;
  n: number;
  win_rate: number | null;
  impor_dikeluarkan: number;
  tanggal_fallback: number; // tanggal tutup bukan dari log (stage_entered_at)
  tanpa_region: number;
  lost_tanpa_alasan: number;
}

export interface PmfScorecard {
  tahun: number | null; // null = semua tahun
  kuartal: number | null; // null = setahun penuh (atau semua tahun)
  periode: { dari: string | null; sampai: string | null }; // null = tanpa batas

  ambang: { min_deal: number; poin: number };
  ringkasan: PmfRingkasan;
  per_brand: PmfSel[];
  sel: PmfSel[];
  per_produk: PmfSel[];
}

const pct = (won: number, n: number): number | null => (n > 0 ? Math.round((won / n) * 1000) / 10 : null);

/** Kuartal (1-4) dari tanggal ISO YYYY-MM-DD. */
export function kuartalDari(tanggal: string): { tahun: number; kuartal: number } {
  const tahun = Number(tanggal.slice(0, 4));
  const bulan = Number(tanggal.slice(5, 7));
  return { tahun, kuartal: Math.floor((bulan - 1) / 3) + 1 };
}

/** Rentang tanggal (inklusif, YYYY-MM-DD) sebuah kuartal. */
export function rentangKuartal(tahun: number, kuartal: number): { dari: string; sampai: string } {
  const bulanAwal = (kuartal - 1) * 3 + 1;
  const bulanAkhir = bulanAwal + 2;
  const hariAkhir = new Date(Date.UTC(tahun, bulanAkhir, 0)).getUTCDate();
  const mm = (m: number) => String(m).padStart(2, "0");
  return { dari: `${tahun}-${mm(bulanAwal)}-01`, sampai: `${tahun}-${mm(bulanAkhir)}-${mm(hariAkhir)}` };
}

/** Status sel dari win-rate sel vs win-rate portofolio — deterministik, tak pernah dari LLM. */
export function statusSel(n: number, winRate: number | null, winRatePortofolio: number | null): PmfStatus {
  if (n < MIN_DEAL || winRate === null || winRatePortofolio === null) return "DATA KURANG";
  const selisih = winRate - winRatePortofolio;
  if (selisih >= AMBANG_POIN) return "MENANG";
  if (selisih <= -AMBANG_POIN) return "KALAH";
  return "NETRAL";
}

/** Normalisasi nama cabang untuk pencocokan peta region (sama dengan join upper(btrim()) di SQL lain). */
export const normCabang = (s: string | null | undefined): string => (s ?? "").trim().toUpperCase();

export function regionDariCabang(cabang: string | null, peta: Record<string, string>): PmfRegion {
  const r = peta[normCabang(cabang)];
  return r === "East" || r === "West" ? r : TANPA_REGION;
}

/** Rapikan teks produk deal: huruf besar, spasi tunggal, buang awalan nama brand. Kosong → TANPA_PRODUK. */
export function normProduk(produk: string | null | undefined, brand: string | null | undefined): string {
  let p = (produk ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  const b = (brand ?? "").replace(/\s+/g, " ").trim().toUpperCase();
  if (b && p.startsWith(b + " ")) p = p.slice(b.length + 1).trim();
  return p || TANPA_PRODUK;
}

function bangunSel(
  brand: string,
  region: PmfSel["region"],
  deals: DealTerminal[],
  winRatePortofolio: number | null,
): PmfSel {
  const won = deals.filter((d) => d.menang).length;
  const n = deals.length;
  const wr = pct(won, n);
  const status = statusSel(n, wr, winRatePortofolio);
  return {
    brand,
    region,
    won,
    lost: n - won,
    n,
    win_rate: wr,
    selisih_poin: wr !== null && winRatePortofolio !== null ? Math.round((wr - winRatePortofolio) * 10) / 10 : null,
    status,
    lost_tanpa_alasan: deals.filter((d) => !d.menang && !d.alasan_kalah).length,
  };
}

/** Fungsi murni: agregasi deal terminal satu periode jadi scorecard. Deal impor tidak ikut dihitung. */
export function hitungScorecard(
  deals: DealTerminal[],
  tahun: number | null,
  kuartal: number | null,
  periode?: { dari: string | null; sampai: string | null },
): PmfScorecard {
  const dihitung = deals.filter((d) => !d.impor);
  const won = dihitung.filter((d) => d.menang).length;
  const n = dihitung.length;
  const wrPortofolio = pct(won, n);

  const perBrand = new Map<string, DealTerminal[]>();
  const perSel = new Map<string, DealTerminal[]>();
  const perProduk = new Map<string, DealTerminal[]>();
  for (const d of dihitung) {
    const brand = d.brand?.trim() || TANPA_BRAND;
    (perBrand.get(brand) ?? perBrand.set(brand, []).get(brand)!).push(d);
    const kunci = `${brand}\u0000${d.region}`;
    (perSel.get(kunci) ?? perSel.set(kunci, []).get(kunci)!).push(d);
    const kunciProduk = `${brand}\u0000${normProduk(d.produk, brand)}`;
    (perProduk.get(kunciProduk) ?? perProduk.set(kunciProduk, []).get(kunciProduk)!).push(d);
  }

  const urut = (a: PmfSel, b: PmfSel) => b.n - a.n || a.brand.localeCompare(b.brand) || a.region.localeCompare(b.region);
  const sel = [...perSel.entries()]
    .map(([kunci, ds]) => {
      const [brand, region] = kunci.split("\u0000") as [string, PmfRegion];
      return bangunSel(brand, region, ds, wrPortofolio);
    })
    .sort(urut);
  const per_brand = [...perBrand.entries()]
    .map(([brand, ds]) => bangunSel(brand, "Semua region", ds, wrPortofolio))
    .sort(urut);
  const per_produk = [...perProduk.entries()]
    .map(([kunci, ds]) => {
      const [brand, produk] = kunci.split("\u0000") as [string, string];
      return { ...bangunSel(brand, "Semua region", ds, wrPortofolio), produk };
    })
    .sort((a, b) => b.n - a.n || a.brand.localeCompare(b.brand) || a.produk.localeCompare(b.produk));

  return {
    tahun,
    kuartal,
    periode: periode ?? (tahun !== null && kuartal !== null ? rentangKuartal(tahun, kuartal) : { dari: null, sampai: null }),
    ambang: { min_deal: MIN_DEAL, poin: AMBANG_POIN },
    ringkasan: {
      won,
      lost: n - won,
      n,
      win_rate: wrPortofolio,
      impor_dikeluarkan: deals.length - n,
      tanggal_fallback: dihitung.filter((d) => !d.tanggal_dari_log).length,
      tanpa_region: dihitung.filter((d) => d.region === TANPA_REGION).length,
      lost_tanpa_alasan: dihitung.filter((d) => !d.menang && !d.alasan_kalah).length,
    },
    per_brand,
    sel,
    per_produk,
  };
}

interface BarisDeal {
  stage: string;
  brand: string | null;
  produk: string | null;
  cabang: string | null;
  alasan_kalah: string | null;
  impor: boolean;
  dari_log: boolean;
}

/** Pilihan periode dari query: angka, "semua" (tanpa filter), atau null (tak diisi → default). */
export type PilihanPeriode = number | "semua" | null;

/** Validasi param kuartal dari query. null = tak diisi; "semua" = semua tahun / setahun penuh; string lain = pesan galat (400). */
export function bacaParamKuartal(tahunRaw: string | undefined, kuartalRaw: string | undefined):
  { tahun: PilihanPeriode; kuartal: PilihanPeriode } | string {
  const kosong = (v: string | undefined) => v === undefined || v.trim() === "";
  const semua = (v: string | undefined) => v?.trim().toLowerCase() === "semua";
  const tahun = kosong(tahunRaw) ? null : semua(tahunRaw) ? "semua" : Number(tahunRaw);
  const kuartal = kosong(kuartalRaw) ? null : semua(kuartalRaw) ? "semua" : Number(kuartalRaw);
  if (typeof tahun === "number" && !(Number.isInteger(tahun) && tahun >= 2000 && tahun <= 2100)) return "tahun harus angka 2000-2100 atau semua";
  if (typeof kuartal === "number" && !(Number.isInteger(kuartal) && kuartal >= 1 && kuartal <= 4)) return "kuartal harus 1-4 atau semua";
  return { tahun, kuartal };
}

/**
 * Kuartal default saat user tak memilih: kuartal deal tertutup TERAKHIR, maksimal kuartal berjalan.
 * Kuartal berjalan hampir selalu kosong di awal kuartal — halaman pertama yang kosong menyesatkan.
 * Belum ada deal tertutup sama sekali → kuartal berjalan.
 */
export function kuartalDefault(hariIni: string, tutupTerakhir: string | null): { tahun: number; kuartal: number } {
  const sekarang = kuartalDari(hariIni);
  if (!tutupTerakhir) return sekarang;
  const t = kuartalDari(tutupTerakhir);
  return t.tahun * 10 + t.kuartal > sekarang.tahun * 10 + sekarang.kuartal ? sekarang : t;
}

/** Scorecard kuartal (default: kuartal deal tertutup terakhir, lihat kuartalDefault). Hanya SELECT. */
export async function getPmfScorecard(tahunIn?: PilihanPeriode, kuartalIn?: PilihanPeriode): Promise<PmfScorecard> {
  const sql = db();
  const hariIni = wibToday().toISOString().slice(0, 10);
  let def = kuartalDari(hariIni);
  if (tahunIn == null && kuartalIn == null) {
    const [r] = await sql<{ tgl: string | null }[]>`
      SELECT max((coalesce(x.tgl_log, d.stage_entered_at) AT TIME ZONE 'Asia/Jakarta')::date)::text AS tgl
      FROM deal d
      CROSS JOIN LATERAL (
        SELECT (SELECT max(l.occurred_at) FROM spt_state_log l
                 WHERE l.deal_id = d.deal_id AND l.to_stage = d.stage::text) AS tgl_log
      ) x
      WHERE d.stage IN ('Closing-Won', 'Closing-Lost') AND d.opsi_utama
        AND NOT EXISTS (SELECT 1 FROM spt_state_log l WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran')`;
    def = kuartalDefault(hariIni, r?.tgl ?? null);
  }
  // "semua" tahun = seluruh riwayat (kuartal ikut diabaikan); kuartal "semua" = setahun penuh.
  const semuaTahun = tahunIn === "semua";
  const tahun = semuaTahun ? null : typeof tahunIn === "number" ? tahunIn : (kuartalIn == null ? def.tahun : kuartalDari(hariIni).tahun);
  const kuartal = semuaTahun || kuartalIn === "semua" ? null : typeof kuartalIn === "number" ? kuartalIn : def.kuartal;
  const periode = tahun === null
    ? { dari: null, sampai: null }
    : kuartal === null ? { dari: `${tahun}-01-01`, sampai: `${tahun}-12-31` } : rentangKuartal(tahun, kuartal);
  const { dari, sampai } = periode;

  const [rows, peta] = await Promise.all([
    sql<BarisDeal[]>`
      SELECT d.stage,
             nullif(btrim(d.brand), '') AS brand,
             nullif(btrim(d.product), '') AS produk,
             coalesce(nullif(btrim(d.cabang), ''), nullif(btrim(mu.cabang), '')) AS cabang,
             d.loss_reason::text AS alasan_kalah,
             EXISTS (SELECT 1 FROM spt_state_log l
                      WHERE l.deal_id = d.deal_id AND l.changed_by = 'import-pameran') AS impor,
             x.tgl_log IS NOT NULL AS dari_log
      FROM deal d
      LEFT JOIN master_user mu ON mu.am_id = d.am_id::text
      CROSS JOIN LATERAL (
        SELECT (SELECT max(l.occurred_at) FROM spt_state_log l
                 WHERE l.deal_id = d.deal_id AND l.to_stage = d.stage::text) AS tgl_log
      ) x
      WHERE d.stage IN ('Closing-Won', 'Closing-Lost')
        AND d.opsi_utama -- Multi-Opsi (274): opsi di-drop bukan kekalahan
        ${dari !== null && sampai !== null
          ? sql`AND (coalesce(x.tgl_log, d.stage_entered_at) AT TIME ZONE 'Asia/Jakarta')::date
                BETWEEN ${dari}::date AND ${sampai}::date`
          : sql``}`,
    cabangRegionMap(sql),
  ]);

  const petaNorm: Record<string, string> = {};
  for (const [cabang, region] of Object.entries(peta)) petaNorm[normCabang(cabang)] = region;

  const deals: DealTerminal[] = rows.map((r) => ({
    brand: r.brand,
    produk: r.produk,
    region: regionDariCabang(r.cabang, petaNorm),
    menang: r.stage === "Closing-Won",
    impor: r.impor,
    tanggal_dari_log: r.dari_log,
    alasan_kalah: r.alasan_kalah,
  }));
  return hitungScorecard(deals, tahun, kuartal, periode);
}
