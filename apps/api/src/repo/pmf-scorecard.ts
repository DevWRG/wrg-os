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

import { db } from "../db.js";
import { cabangRegionMap } from "./sales.js";
import { wibToday } from "./watchpoint-week.js";

export const MIN_DEAL = 5;
export const AMBANG_POIN = 10;
export const TANPA_BRAND = "(tanpa brand)";
export const TANPA_REGION = "Tanpa region";

export type PmfRegion = "East" | "West" | typeof TANPA_REGION;
export type PmfStatus = "MENANG" | "NETRAL" | "KALAH" | "DATA KURANG";

/** Satu deal terminal, sudah dinormalisasi dari baris DB. */
export interface DealTerminal {
  brand: string | null;
  region: PmfRegion;
  menang: boolean;
  impor: boolean;
  tanggal_dari_log: boolean;
  alasan_kalah: string | null;
}

export interface PmfSel {
  brand: string;
  region: PmfRegion | "Semua region";
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
  tahun: number;
  kuartal: number;
  periode: { dari: string; sampai: string };
  ambang: { min_deal: number; poin: number };
  ringkasan: PmfRingkasan;
  per_brand: PmfSel[];
  sel: PmfSel[];
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
  tahun: number,
  kuartal: number,
): PmfScorecard {
  const dihitung = deals.filter((d) => !d.impor);
  const won = dihitung.filter((d) => d.menang).length;
  const n = dihitung.length;
  const wrPortofolio = pct(won, n);

  const perBrand = new Map<string, DealTerminal[]>();
  const perSel = new Map<string, DealTerminal[]>();
  for (const d of dihitung) {
    const brand = d.brand?.trim() || TANPA_BRAND;
    (perBrand.get(brand) ?? perBrand.set(brand, []).get(brand)!).push(d);
    const kunci = `${brand}\u0000${d.region}`;
    (perSel.get(kunci) ?? perSel.set(kunci, []).get(kunci)!).push(d);
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

  return {
    tahun,
    kuartal,
    periode: rentangKuartal(tahun, kuartal),
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
  };
}

interface BarisDeal {
  stage: string;
  brand: string | null;
  cabang: string | null;
  alasan_kalah: string | null;
  impor: boolean;
  dari_log: boolean;
}

/** Scorecard kuartal (default: kuartal WIB berjalan). Hanya SELECT. */
export async function getPmfScorecard(tahunIn?: number, kuartalIn?: number): Promise<PmfScorecard> {
  const sql = db();
  const sekarang = kuartalDari(wibToday().toISOString().slice(0, 10));
  const tahun = tahunIn && tahunIn >= 2000 && tahunIn <= 2100 ? Math.trunc(tahunIn) : sekarang.tahun;
  const kuartal = kuartalIn && kuartalIn >= 1 && kuartalIn <= 4 ? Math.trunc(kuartalIn) : sekarang.kuartal;
  const { dari, sampai } = rentangKuartal(tahun, kuartal);

  const [rows, peta] = await Promise.all([
    sql<BarisDeal[]>`
      SELECT d.stage,
             nullif(btrim(d.brand), '') AS brand,
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
        AND (coalesce(x.tgl_log, d.stage_entered_at) AT TIME ZONE 'Asia/Jakarta')::date
            BETWEEN ${dari}::date AND ${sampai}::date`,
    cabangRegionMap(sql),
  ]);

  const petaNorm: Record<string, string> = {};
  for (const [cabang, region] of Object.entries(peta)) petaNorm[normCabang(cabang)] = region;

  const deals: DealTerminal[] = rows.map((r) => ({
    brand: r.brand,
    region: regionDariCabang(r.cabang, petaNorm),
    menang: r.stage === "Closing-Won",
    impor: r.impor,
    tanggal_dari_log: r.dari_log,
    alasan_kalah: r.alasan_kalah,
  }));
  return hitungScorecard(deals, tahun, kuartal);
}
