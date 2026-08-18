// Produktivitas aset KSO (view kso_asset_produktivitas_v, migrasi 097-105).
// Menu /kso-produktivitas di apps/web.
//
// CUMA BACA, DAN SENGAJA TIDAK MENGHITUNG APA PUN DI SINI. Seluruh aturan
// atribusi ada di view: pembagian porsi KSO untuk faskes berskema ganda (102),
// pagar penyebut (100), kategori yang berlaku per skema (101), dan pembanding
// tes dari Accurate (103-105). Menyalin sebagian rumus ke TypeScript berarti
// dua sumber kebenaran yang akan menyimpang diam-diam.
//
// Payload penuh sekaligus (±520 baris aset) — kecil, dan user memfilter serta
// mengurutkan bolak-balik saat membandingkan faskes.

import { db, isDbEnabled } from "../db.js";

export interface KsoProduktivitasRow {
  assetId: number;
  snKey: string;
  customerRaw: string;
  accountId: number | null;
  faskes: string | null;          // nama di accurate_customer
  kota: string | null;
  typeAlat: string | null;
  namaAlat: string | null;
  skema: string;
  targetJumlahTes: number | null;
  totalTes: number | null;
  rataTesBulanan: number | null;
  capaianTarget: number | null;
  revenueNettoCustomer: number | null;
  alatSeskemaDiCustomer: number | null;
  totalTesCustomerSeskema: number | null;
  rupiahPerTesCustomer: number | null;
  basisTesMemadai: boolean;
  porsiKso: number | null;
  revenueTumpangTindih: boolean;
  tesSheetPeriodeBanding: number | null;
  tesDitagihkanAccurate: number | null;
  rasioTagihLapor: number | null;
  bulanTertagihAccurate: number | null;
  tagihPolaDatar: boolean;
  statusPenagihan: string | null;
}

// Satu titik tren = satu (skema, bulan). Sumber: kso_tren_bulanan_v (migrasi 106).
export interface KsoTrenRow {
  skema: string;
  periode: string;             // 'YYYY-MM-01'
  jumlahTes: number | null;    // NULL = bulan itu TIDAK ADA laporan, bukan nol tes
  alatLapor: number | null;
  faskesLapor: number | null;
  revenueNetto: number | null;
}

export interface KsoProduktivitas {
  rows: KsoProduktivitasRow[];
  tren: KsoTrenRow[];
  ringkasan: {
    aset: number;
    faskes: number;
    // Baris yang benar-benar bisa diperingkat: pagar penyebut LULUS *dan* Rp/tes ada.
  // Dua syarat, bukan satu: 9 baris lolos pagar tapi Rp/tes-nya NULL karena tidak
  // punya revenue sama sekali (mayoritas status_penagihan = 'tanpa_faktur').
  // Menghitung basis_tes_memadai saja membuat angka ini melebih-lebihkan.
  layakDiperingkat: number;
    medianRpPerTes: Record<string, number | null>;  // per skema
  };
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function produktivitas(): Promise<KsoProduktivitas> {
  if (!isDbEnabled()) return { rows: [], tren: [], ringkasan: { aset: 0, faskes: 0, layakDiperingkat: 0, medianRpPerTes: {} } };
  const sql = db();

  const rows = await sql`
    SELECT v.asset_id, v.sn_key, v.customer_raw, v.account_id,
           c.name AS faskes, v.kota, v.type_alat, v.nama_alat, v.skema,
           v.target_jumlah_tes, v.total_tes, v.rata_tes_bulanan, v.capaian_target,
           v.revenue_netto_customer, v.alat_seskema_di_customer, v.total_tes_customer_seskema,
           v.rupiah_per_tes_customer, v.basis_tes_memadai, v.porsi_kso, v.revenue_tumpang_tindih,
           v.tes_sheet_periode_banding, v.tes_ditagihkan_accurate, v.rasio_tagih_lapor,
           v.bulan_tertagih_accurate, v.tagih_pola_datar, v.status_penagihan
    FROM kso_asset_produktivitas_v v
    LEFT JOIN accurate_customer c ON c.id = v.account_id
    ORDER BY v.skema, v.rupiah_per_tes_customer DESC NULLS LAST, v.customer_raw`;

  // Median dihitung di SQL, bukan di TS: percentile_cont menangani jumlah baris
  // genap dengan benar dan ikut aturan NULL yang sama dengan view.
  const med = await sql`
    SELECT skema,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY rupiah_per_tes_customer) AS median
    FROM (SELECT DISTINCT account_id, skema, rupiah_per_tes_customer
          FROM kso_asset_produktivitas_v
          WHERE basis_tes_memadai AND rupiah_per_tes_customer IS NOT NULL) x
    GROUP BY skema`;

  const medianRpPerTes: Record<string, number | null> = {};
  for (const m of med) medianRpPerTes[String(m.skema)] = num(m.median);

  // Tren bulanan. Bulan tanpa laporan tes TIDAK diisi nol di sini — biar sisi UI yang
  // memutuskan cara menggambarnya; menstempel 0 di lapisan ini menghapus perbedaan
  // antara "tidak ada laporan" dan "benar-benar nol tes", dan itu tidak bisa dipulihkan
  // lagi di atasnya.
  // `periode` di-format DI SQL, bukan lewat Date di TS: kolomnya bertipe date, dan
  // Date.toISOString() menormalkan ke UTC — di WIB (UTC+7) tanggal 1 bisa tergeser jadi
  // tanggal 31 bulan sebelumnya, yang berarti seluruh grafik meleset satu bulan.
  const tren = await sql`
    SELECT skema, to_char(periode, 'YYYY-MM-DD') AS periode,
           jumlah_tes, alat_lapor, faskes_lapor, revenue_netto
    FROM kso_tren_bulanan_v
    ORDER BY skema, periode`;

  return {
    rows: rows.map((r) => ({
      assetId: Number(r.asset_id),
      snKey: String(r.sn_key),
      customerRaw: String(r.customer_raw),
      accountId: num(r.account_id),
      faskes: r.faskes ? String(r.faskes) : null,
      kota: r.kota ? String(r.kota) : null,
      typeAlat: r.type_alat ? String(r.type_alat) : null,
      namaAlat: r.nama_alat ? String(r.nama_alat) : null,
      skema: String(r.skema),
      targetJumlahTes: num(r.target_jumlah_tes),
      totalTes: num(r.total_tes),
      rataTesBulanan: num(r.rata_tes_bulanan),
      capaianTarget: num(r.capaian_target),
      revenueNettoCustomer: num(r.revenue_netto_customer),
      alatSeskemaDiCustomer: num(r.alat_seskema_di_customer),
      totalTesCustomerSeskema: num(r.total_tes_customer_seskema),
      rupiahPerTesCustomer: num(r.rupiah_per_tes_customer),
      basisTesMemadai: Boolean(r.basis_tes_memadai),
      porsiKso: num(r.porsi_kso),
      revenueTumpangTindih: Boolean(r.revenue_tumpang_tindih),
      tesSheetPeriodeBanding: num(r.tes_sheet_periode_banding),
      tesDitagihkanAccurate: num(r.tes_ditagihkan_accurate),
      rasioTagihLapor: num(r.rasio_tagih_lapor),
      bulanTertagihAccurate: num(r.bulan_tertagih_accurate),
      tagihPolaDatar: Boolean(r.tagih_pola_datar),
      statusPenagihan: r.status_penagihan ? String(r.status_penagihan) : null,
    })),
    tren: tren.map((t) => ({
      skema: String(t.skema),
      periode: String(t.periode),
      jumlahTes: num(t.jumlah_tes),
      alatLapor: num(t.alat_lapor),
      faskesLapor: num(t.faskes_lapor),
      revenueNetto: num(t.revenue_netto),
    })),
    ringkasan: {
      aset: rows.length,
      faskes: new Set(rows.map((r) => String(r.account_id))).size,
      layakDiperingkat: rows.filter((r) => r.basis_tes_memadai && r.rupiah_per_tes_customer !== null).length,
      medianRpPerTes,
    },
  };
}
