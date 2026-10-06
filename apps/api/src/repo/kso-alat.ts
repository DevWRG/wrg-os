// Daftar Alat — SEMUA alat yang dikelola WRG (kso_asset), dengan status dan
// SUMBER status itu (view kso_asset_status_v, migrasi 197). Menu /kso-alat.
//
// CUMA BACA. Status ditetapkan di SQL (kso_asset_status_kode) karena aturan
// yang sama menentukan baris Produktivitas KSO — menyalinnya ke TypeScript
// membuat dua definisi "operasional" yang akan menyimpang diam-diam.
//
// Metrik produktivitas (rata tes/bln, capaian target) diambil dari snapshot
// Produktivitas KSO, bukan dihitung ulang. Alat yang tidak masuk Produktivitas
// tampil tanpa angka — dan penandanya menyebut kenapa.
//
// Payload penuh sekaligus (±600 baris): kecil, dan filter/urut di klien.

import { db, isDbEnabled } from "../db.js";

export interface KsoAlatRow {
  assetId: number;
  snKey: string;
  snRaw: string | null;
  namaAlat: string | null;
  typeAlat: string | null;
  customerRaw: string;
  faskes: string | null;
  accountId: number | null;
  kota: string | null;
  outlet: string | null;
  station: string | null;
  skema: string;
  pemilikAlat: string | null;
  tglSj: string | null;
  statusKode: string;
  statusLabel: string;
  statusSumber: string;
  operasional: boolean;
  masukProduktivitas: boolean;
  penanda: string[];
  rataTesBulanan: number | null;
  capaianTarget: number | null;
  updatedAt: string | null;
}

export interface KsoAlat {
  rows: KsoAlatRow[];
  /** Jumlah alat per status — seluruh data, tidak ikut filter di layar. */
  perStatus: Array<{ kode: string; label: string; jumlah: number }>;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

export async function daftarAlat(): Promise<KsoAlat> {
  if (!isDbEnabled()) return { rows: [], perStatus: [] };
  const sql = db();

  const rows = await sql`
    SELECT a.id, a.sn_key, a.sn_raw, a.nama_alat, a.type_alat, a.customer_raw,
           c.name AS faskes, a.account_id, a.kota, a.outlet, a.station, a.skema,
           a.pemilik_alat, a.tgl_sj,
           s.status_kode, s.status_label, s.status_sumber, s.operasional,
           s.masuk_produktivitas, s.penanda,
           m.rata_tes_bulanan, m.capaian_target,
           to_char(a.updated_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI') AS updated_at
    FROM kso_asset a
    JOIN kso_asset_status_v s ON s.id = a.id
    LEFT JOIN accurate_customer c ON c.id = a.account_id
    LEFT JOIN kso_asset_produktivitas_mv m ON m.asset_id = a.id
    -- id sebagai pemecah seri supaya urutan tidak berubah sendiri sehabis VACUUM.
    ORDER BY s.operasional DESC, s.status_label, a.customer_raw, a.id`;

  const per = await sql`
    SELECT status_kode, status_label, count(*)::int AS jumlah
    FROM kso_asset_status_v
    GROUP BY 1, 2
    ORDER BY jumlah DESC`;

  return {
    rows: rows.map((r) => ({
      assetId: Number(r.id),
      snKey: String(r.sn_key),
      snRaw: str(r.sn_raw),
      namaAlat: str(r.nama_alat),
      typeAlat: str(r.type_alat),
      customerRaw: String(r.customer_raw),
      faskes: str(r.faskes),
      accountId: num(r.account_id),
      kota: str(r.kota),
      outlet: str(r.outlet),
      station: str(r.station),
      skema: String(r.skema),
      pemilikAlat: str(r.pemilik_alat),
      tglSj: str(r.tgl_sj),
      statusKode: String(r.status_kode),
      statusLabel: String(r.status_label),
      statusSumber: String(r.status_sumber),
      operasional: Boolean(r.operasional),
      masukProduktivitas: Boolean(r.masuk_produktivitas),
      penanda: Array.isArray(r.penanda) ? r.penanda.map(String) : [],
      rataTesBulanan: num(r.rata_tes_bulanan),
      capaianTarget: num(r.capaian_target),
      updatedAt: str(r.updated_at),
    })),
    perStatus: per.map((p) => ({ kode: String(p.status_kode), label: String(p.status_label), jumlah: Number(p.jumlah) })),
  };
}
