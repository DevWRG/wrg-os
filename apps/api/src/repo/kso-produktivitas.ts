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

// ── Detail satu faskes (dialog "Lihat detail" di /kso-produktivitas) ────────────────
//
// Endpoint TERPISAH, tidak digabung ke payload utama: riwayat bulanan seluruh faskes
// berarti ±189 faskes x 20 bulan x 2 skema di setiap muat halaman, padahal yang dibuka
// pengguna paling banyak beberapa. Diambil saat dialognya dibuka.
export interface KsoFaskesDetail {
  alat: {
    assetId: number; snKey: string; snRaw: string | null;
    typeAlat: string | null; namaAlat: string | null;
    targetJumlahTes: number | null; totalTes: number | null;
    rataTesBulanan: number | null; capaianTarget: number | null;
  }[];
  tren: { periode: string; jumlahTes: number | null; alatLapor: number | null; revenueNetto: number | null }[];
  // Riwayat tes PER ALAT. Ada karena kso_asset_test_monthly memang per aset.
  //
  // TIDAK ADA padanannya untuk revenue, dan itu bukan kelalaian: faktur Accurate terbit
  // atas nama FASKES, tak satu pun kolom menautkan rupiah ke unit tertentu. Memecahnya
  // (rata atau proporsional-tes) menghasilkan angka yang terlihat presisi padahal
  // karangan — alasan yang sama dengan rupiah_per_tes_customer di migrasi 098/100.
  trenAlat: { assetId: number; periode: string; jumlahTes: number | null }[];
  // Reagen/barang yang difakturkan ke faskes ini pada jendela yang diminta.
  // `dalamSkema` = kategori pengadaannya termasuk yang dihitung sebagai revenue skema
  // ini (kso_kategori_skema). Yang FALSE tetap dikembalikan, bukan disaring: item
  // REGULAR yang muncul di faskes PER_TEST justru temuan, bukan derau — dan kalau
  // disembunyikan, tidak ada yang akan pernah menanyakannya.
  reagen: {
    itemId: number | null; itemNo: string | null; itemNama: string | null;
    jenisAlat: string | null; kategori: string; unit: string;
    qty: number | null; nilaiNetto: number | null; jumlahFaktur: number | null;
    dalamSkema: boolean;
  }[];
}

// `dari`/`sampai` = jendela bulan ('YYYY-MM-DD', tanggal 1). WAJIB dikirim pemanggil,
// bukan dihitung di sini: dialog memakai jendela yang sama untuk grafiknya, dan kalau
// server menghitung sendiri "tahun berjalan" keduanya bisa berbeda saat pergantian tahun
// atau beda timezone — daftar reagen lalu tidak sepadan dengan grafik di atasnya.
export async function faskesDetail(
  accountId: number, skema: string, dari: string, sampai: string,
): Promise<KsoFaskesDetail> {
  if (!isDbEnabled()) return { alat: [], tren: [], trenAlat: [], reagen: [] };
  const sql = db();

  // Daftar alat dari view produktivitas, BUKAN langsung dari kso_asset: view itu yang
  // memegang aturan cakupan (hanya aset ber-account_id & berskema dikenal), jadi isi
  // dialog tidak akan pernah memuat aset yang tidak terhitung di barisnya.
  const alat = await sql`
    SELECT asset_id, sn_key, type_alat, nama_alat,
           target_jumlah_tes, total_tes, rata_tes_bulanan, capaian_target
    FROM kso_asset_produktivitas_v
    WHERE account_id = ${accountId} AND skema = ${skema}
    ORDER BY total_tes DESC NULLS LAST, nama_alat`;

  // sn_raw tidak ada di view; diambil terpisah supaya view tidak perlu diubah hanya
  // demi satu kolom tampilan.
  const snRaw = await sql`
    SELECT id, sn_raw FROM kso_asset
    WHERE account_id = ${accountId} AND skema = ${skema}`;
  const rawById = new Map(snRaw.map((r) => [Number(r.id), r.sn_raw ? String(r.sn_raw) : null]));

  const tren = await sql`
    SELECT to_char(periode, 'YYYY-MM-DD') AS periode, jumlah_tes, alat_lapor, revenue_netto
    FROM kso_faskes_tren_v
    WHERE account_id = ${accountId} AND skema = ${skema}
    ORDER BY periode`;

  // Dibatasi ke aset milik faskes+skema ini lewat JOIN, bukan lewat daftar id dari
  // query sebelumnya: satu sumber cakupan, dan tidak ada peluang dua query melihat
  // himpunan aset yang berbeda.
  const trenAlat = await sql`
    SELECT m.asset_id, to_char(m.periode, 'YYYY-MM-DD') AS periode, m.jumlah_tes
    FROM kso_asset_test_monthly m
    JOIN kso_asset a ON a.id = m.asset_id
    WHERE a.account_id = ${accountId} AND a.skema = ${skema}
    ORDER BY m.asset_id, m.periode`;

  // Kategori yang berlaku bagi skema ini dibaca dari kso_kategori_skema — sumber tunggal
  // aturan atribusi (107). Jangan disalin ke TS.
  // PORSI KSO DITERAPKAN DI SINI, dan itu wajib — bukan penyempurnaan.
  //
  // Kartu "Revenue netto" pada dialog yang sama membaca
  // kso_asset_produktivitas_v.revenue_netto_customer, yang (a) hanya menghitung kategori
  // yang berlaku bagi skema, DAN (b) membagi porsi kategori 'KSO' untuk faskes berskema
  // ganda (migrasi 102). kso_faskes_reagen_v tidak melakukan keduanya — cakupannya
  // seluruh faktur, seluruh kategori, tanpa porsi.
  //
  // Tanpa penyesuaian ini, dua angka di SATU dialog akan bertentangan: pada data prod
  // 2026-08-22 Σ reagen = Rp 29,27 M sementara Σ revenue faskes KSO = Rp 20,73 M (~29%
  // lebih rendah), dan tidak ada yang gagal untuk menandainya. Baris kategori 'KSO'
  // karena itu dikalikan porsi_kso yang sama, dan subtotal dalam-skema menjadi sepadan
  // dengan kartu di atasnya.
  //
  // PORSI DIBACA DARI VIEW, TIDAK DIHITUNG DI SINI.
  //
  // #998 menghitungnya dari `total_tes_customer_seskema` untuk menghindari pembulatan
  // 4 desimal pada kolom `porsi_kso`. Itu keliru, dan migrasi 121 membuktikannya dalam
  // sehari: 121 mengubah aturan porsi untuk faskes yang SALAH SATU sisinya nol tes
  // (pakai porsi berbasis reagen, bukan tes), sementara perhitungan di sini tidak ikut.
  // Untuk NGUDI WALUYO WLINGI porsinya akan TERBALIK PENUH — sisi yang memakai seluruh
  // Rp 675 jt reagen hemodialisa dapat 0 — persis kesalahan yang 121 perbaiki.
  //
  // Alasan menghitung sendiri sudah hilang: migrasi 122 mengekspos porsi_kso dengan 12
  // desimal, jadi selisih pembulatannya di bawah satu rupiah pada nilai miliaran.
  // Aturan porsi tinggal SATU tempat, di SQL — pola yang sama dengan 107.
  const reagen = await sql`
    WITH porsi AS (
      -- COALESCE(...,1) di pemakaiannya: faskes yang tak punya aset pada skema ini tidak
      -- punya baris di sini, dan porsi 1 = "tidak dibagi" — sama seperti skema tunggal.
      SELECT max(porsi_kso) AS porsi
      FROM kso_asset_produktivitas_v
      WHERE account_id = ${accountId} AND skema = ${skema}
    )
    SELECT r.item_id, r.item_no, r.item_nama, r.jenis_alat, r.kategori, r.unit,
           sum(r.qty) AS qty,
           sum(CASE WHEN r.kategori = 'KSO'
                    THEN r.nilai_netto
                         * COALESCE((SELECT porsi FROM porsi), 1)
                    ELSE r.nilai_netto END) AS nilai_netto,
           sum(r.jumlah_faktur)::int AS jumlah_faktur,
           -- Dua jalan masuk "dalam skema", dan yang kedua wajib sejak migrasi 124:
           -- baris penagihan per-tes berkategori 'Tanpa kategori', yang BUKAN anggota
           -- kso_kategori_skema, tapi sejak keputusan HoD 2026-08-22 diakui sebagai
           -- revenue. Tanpa cabang ini subtotal "dalam skema" di tabel ini lebih kecil
           -- dari kartu Revenue netto di dialog yang SAMA — persis yang dilaporkan dari
           -- layar: tabel memuat Rp 16,58 jt penagihan tes, grafik & subtotal tidak.
           --
           -- Keanggotaannya DIBACA dari kso_penagihan_tes_v (migrasi 125), tidak
           -- diputuskan di TS. View itu juga yang dipakai kso_asset_produktivitas_v dan
           -- kso_faskes_tren_v, jadi ketiga angka di dialog ini membaca himpunan yang sama.
           --
           -- account_id dipakai sebagai parameter, bukan r.account_id: query ini sudah
           -- difilter ke satu faskes di WHERE, dan r.account_id tidak ada di GROUP BY.
           (r.kategori IN (SELECT kategori FROM kso_kategori_skema WHERE skema = ${skema})
            OR EXISTS (SELECT 1 FROM kso_penagihan_tes_v pt
                       WHERE pt.account_id = ${accountId} AND pt.skema = ${skema}
                         AND pt.item_id = r.item_id))
             AS dalam_skema
    FROM kso_faskes_reagen_v r
    WHERE r.account_id = ${accountId} AND r.periode BETWEEN ${dari} AND ${sampai}
    GROUP BY r.item_id, r.item_no, r.item_nama, r.jenis_alat, r.kategori, r.unit
    ORDER BY sum(r.nilai_netto) DESC NULLS LAST`;

  return {
    alat: alat.map((a) => ({
      assetId: Number(a.asset_id),
      snKey: String(a.sn_key),
      snRaw: rawById.get(Number(a.asset_id)) ?? null,
      typeAlat: a.type_alat ? String(a.type_alat) : null,
      namaAlat: a.nama_alat ? String(a.nama_alat) : null,
      targetJumlahTes: num(a.target_jumlah_tes),
      totalTes: num(a.total_tes),
      rataTesBulanan: num(a.rata_tes_bulanan),
      capaianTarget: num(a.capaian_target),
    })),
    tren: tren.map((t) => ({
      periode: String(t.periode),
      jumlahTes: num(t.jumlah_tes),
      alatLapor: num(t.alat_lapor),
      revenueNetto: num(t.revenue_netto),
    })),
    trenAlat: trenAlat.map((t) => ({
      assetId: Number(t.asset_id),
      periode: String(t.periode),
      jumlahTes: num(t.jumlah_tes),
    })),
    reagen: reagen.map((r) => ({
      itemId: num(r.item_id),
      itemNo: r.item_no ? String(r.item_no) : null,
      itemNama: r.item_nama ? String(r.item_nama) : null,
      jenisAlat: r.jenis_alat ? String(r.jenis_alat) : null,
      kategori: String(r.kategori),
      unit: String(r.unit),
      qty: num(r.qty),
      nilaiNetto: num(r.nilai_netto),
      jumlahFaktur: num(r.jumlah_faktur),
      dalamSkema: Boolean(r.dalam_skema),
    })),
  };
}
