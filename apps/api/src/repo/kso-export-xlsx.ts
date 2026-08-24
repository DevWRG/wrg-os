// Export Produktivitas KSO ke .xlsx MULTI-SHEET (permintaan user 2026-08-24:
// "tambahin jumlah reagennya juga, dibedakan di sheet").
//
// ── KENAPA .xlsx DI SERVER, BUKAN CSV DI KLIEN ────────────────────────────────────
// CSV tidak punya sheet. Permintaannya justru memisahkan reagen dari produktivitas ke
// sheet sendiri, jadi formatnya harus workbook sungguhan.
//
// Dibuat di apps/api, mengikuti pola deck PPTX (`watchpoint-pptx.ts` + route proxy di
// web): library Office tinggal di server, dan bundle halaman tidak ikut membesar.
//
// Reagen SELURUH faskes juga tidak mungkin dirakit di klien — dialog detail memuatnya
// satu faskes per permintaan, jadi 68 faskes berarti 68 panggilan. Di sini satu query.
//
// ── ANGKA DIKIRIM SEBAGAI NUMBER, BUKAN STRING ───────────────────────────────────
// Ini keuntungan .xlsx yang tidak dimiliki CSV: tipe sel disimpan di dalam berkas, jadi
// tidak ada lagi tafsir locale. Cacat #1028 (titik desimal dibaca Excel Indonesia sebagai
// pemisah ribuan sehingga Rp 29 jt tampil 29 triliun) TIDAK BISA terjadi di sini —
// asalkan nilainya benar-benar dikirim sebagai number, bukan sudah diformat jadi teks.
// Karena itu `numFmt` yang mengatur tampilan, bukan string yang sudah dirangkai.

import ExcelJS from "exceljs";

import { db, isDbEnabled } from "../db.js";

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export interface KsoExportOpts {
  skema: string;
  dari: string;   // 'YYYY-MM-01'
  sampai: string; // 'YYYY-MM-01'
}

// Format angka Excel bergaya Indonesia. Titik ribuan & koma desimal ditentukan oleh
// LOCALE PEMBACA saat dirender — yang disimpan di berkas cuma polanya, jadi berkasnya
// tetap benar di Excel mana pun. Itu bedanya dengan CSV.
const FMT_RP = "#,##0";
const FMT_INT = "#,##0";
const FMT_1D = "#,##0.0";
const FMT_3D = "0.000";

export async function buildKsoWorkbook(opts: KsoExportOpts): Promise<Buffer> {
  if (!isDbEnabled()) throw new Error("db disabled");
  const sql = db();
  const { skema, dari, sampai } = opts;

  // ── Sheet 1: satu baris per ASET, DIBATASI RENTANG ─────────────────────────────
  // Keputusan user 2026-08-24: "semua sheet dibikin satu cakupan aja". Versi pertama
  // memakai kolom agregat `kso_asset_produktivitas_v` apa adanya — itu SELURUH periode,
  // sementara sheet 2-3 mengikuti rentang, sehingga Σ revenue bulanan tidak pernah cocok
  // dengan kolom Revenue netto faskes. Cakupan berbeda berdampingan sudah lima kali jadi
  // laporan "data tidak sinkron" di rangkaian ini; di dalam berkas yang beredar lepas
  // dari layarnya, itu lebih sulit lagi dijelaskan.
  //
  // Jadi tes, revenue, Rp/tes, rata/bln, dan capaian DIHITUNG ULANG dalam rentang.
  //
  // EMPAT KOLOM TETAP SELURUH PERIODE, dan headernya menyebutnya — bukan kelalaian:
  //   porsi_kso            aturannya (102/121/122) ditetapkan atas seluruh data; porsi
  //                        "versi Maret-Mei" bukan besaran yang punya arti
  //   basis_tes_memadai    ambangnya 100 tes per TAHUN
  //   rasio tagih/lapor    basisnya `periode_sheet` sendiri (103-105), bukan rentang ini
  //   status_penagihan     turunan dari basis yang sama
  // Memaksanya mengikuti rentang berarti mengarang definisi baru yang kebetulan bernama
  // sama — persis cara sebuah angka jadi salah tanpa terlihat salah.
  const alat = await sql`
    WITH tes_aset AS (   -- tes per ASET dalam rentang
      SELECT m.asset_id,
             sum(m.jumlah_tes)                                  AS tes,
             count(*) FILTER (WHERE m.jumlah_tes IS NOT NULL)    AS bulan_lapor
      FROM kso_asset_test_monthly m
      WHERE m.periode BETWEEN ${dari} AND ${sampai}
      GROUP BY m.asset_id
    ),
    faskes_rentang AS (  -- tes & revenue per FASKES dalam rentang, dari view tren (126)
      SELECT account_id, sum(jumlah_tes) AS tes, sum(revenue_netto) AS revenue
      FROM kso_faskes_tren_v
      WHERE skema = ${skema} AND periode BETWEEN ${dari} AND ${sampai}
      GROUP BY account_id
    )
    SELECT v.asset_id, v.sn_key, a.sn_raw, v.customer_raw, v.account_id,
           c.name AS faskes, v.kota, v.type_alat, v.nama_alat, v.skema,
           v.target_jumlah_tes,
           ta.tes                                               AS tes_alat_rentang,
           CASE WHEN ta.bulan_lapor > 0
                THEN ta.tes::numeric / ta.bulan_lapor END       AS rata_tes_rentang,
           CASE WHEN v.target_jumlah_tes > 0 AND ta.bulan_lapor > 0
                THEN round((ta.tes::numeric / ta.bulan_lapor) / v.target_jumlah_tes, 3)
                END                                             AS capaian_rentang,
           v.alat_seskema_di_customer,
           fr.tes                                               AS tes_faskes_rentang,
           fr.revenue                                           AS revenue_rentang,
           CASE WHEN fr.tes > 0 AND fr.revenue IS NOT NULL
                THEN round(fr.revenue / fr.tes, 2) END          AS rp_per_tes_rentang,
           -- kolom di bawah ini SELURUH periode (lihat komentar di atas)
           v.basis_tes_memadai, v.porsi_kso, v.revenue_tumpang_tindih,
           v.tes_sheet_periode_banding, v.tes_ditagihkan_accurate, v.rasio_tagih_lapor,
           v.bulan_tertagih_accurate, v.tagih_pola_datar, v.status_penagihan
    FROM kso_asset_produktivitas_v v
    LEFT JOIN accurate_customer c ON c.id = v.account_id
    LEFT JOIN kso_asset a ON a.id = v.asset_id
    LEFT JOIN tes_aset ta ON ta.asset_id = v.asset_id
    LEFT JOIN faskes_rentang fr ON fr.account_id = v.account_id
    WHERE v.skema = ${skema}
    ORDER BY c.name NULLS LAST, v.customer_raw, v.nama_alat`;

  // ── Sheet 2: REAGEN, inti permintaan ────────────────────────────────────────────
  // Dibaca dari kso_faskes_reagen_skema_v (155) — view yang sama dengan dialog detail,
  // jadi angka di berkas dan di layar tidak mungkin berbeda aturannya.
  // `nilai_netto_skema` (sudah dikali porsi KSO), bukan nilai mentah.
  const reagen = await sql`
    SELECT r.account_id, c.name AS faskes,
           to_char(r.periode, 'YYYY-MM-DD') AS periode,
           r.item_no, r.item_nama, r.jenis_alat, r.kategori, r.unit,
           r.qty, r.nilai_netto_skema, r.jumlah_faktur,
           r.dalam_skema, r.penagihan_tes
    FROM kso_faskes_reagen_skema_v r
    LEFT JOIN accurate_customer c ON c.id = r.account_id
    WHERE r.skema = ${skema} AND r.periode BETWEEN ${dari} AND ${sampai}
    ORDER BY c.name NULLS LAST, r.periode, r.nilai_netto_skema DESC NULLS LAST`;

  // ── Sheet 3: tes & revenue per faskes per bulan ──────────────────────────────────
  const bulanan = await sql`
    SELECT t.account_id, c.name AS faskes,
           to_char(t.periode, 'YYYY-MM-DD') AS periode,
           t.jumlah_tes, t.alat_lapor, t.revenue_netto
    FROM kso_faskes_tren_v t
    LEFT JOIN accurate_customer c ON c.id = t.account_id
    WHERE t.skema = ${skema} AND t.periode BETWEEN ${dari} AND ${sampai}
    ORDER BY c.name NULLS LAST, t.periode`;

  const wb = new ExcelJS.Workbook();
  wb.creator = "WRG-OS";

  // Baris pertama dibekukan di setiap sheet + autofilter: berkas ini dibuka untuk
  // disaring dan di-pivot, dan tanpa freeze header hilang setelah beberapa gulir.
  const pasangHeader = (ws: ExcelJS.Worksheet, kolom: Array<{ h: string; w: number; fmt?: string }>) => {
    ws.columns = kolom.map((k) => ({ header: k.h, width: k.w, style: k.fmt ? { numFmt: k.fmt } : undefined }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kolom.length } };
  };

  const yaTidak = (v: unknown) => (v ? "ya" : "");
  const bulat = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n); };
  const satuDesimal = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n * 10) / 10; };

  // ── Sheet: Produktivitas per alat ────────────────────────────────────────────────
  const s1 = wb.addWorksheet("Produktivitas per alat");
  pasangHeader(s1, [
    { h: "Faskes", w: 38 }, { h: "Kota", w: 20 }, { h: "Skema", w: 13 },
    { h: "Account ID", w: 12, fmt: FMT_INT }, { h: "Nama di sheet", w: 34 },
    { h: "SN", w: 20 }, { h: "SN mentah", w: 20 }, { h: "Nama alat", w: 26 }, { h: "Jenis alat", w: 20 },
    { h: "Target tes/bln", w: 14, fmt: FMT_INT }, { h: "Tes alat ini", w: 14, fmt: FMT_INT },
    { h: "Rata tes/bln alat ini", w: 18, fmt: FMT_1D }, { h: "Capaian target alat ini", w: 18, fmt: FMT_3D },
    { h: "Alat seskema di faskes", w: 18, fmt: FMT_INT }, { h: "Tes faskes", w: 14, fmt: FMT_INT },
    { h: "Revenue netto faskes", w: 20, fmt: FMT_RP }, { h: "Rp per tes (faskes)", w: 18, fmt: FMT_RP },
    // Empat kolom terakhir sengaja BERLABEL "seluruh periode": definisinya bukan
    // per-rentang, dan memaksanya ikut rentang = mengarang besaran baru bernama sama.
    { h: "Penyebut memadai (seluruh periode)", w: 24 }, { h: "Porsi KSO (seluruh periode)", w: 20, fmt: FMT_3D },
    { h: "Skema ganda", w: 12 },
    { h: "Tes dilaporkan (periode banding)", w: 24, fmt: FMT_INT },
    { h: "Tes ditagihkan (periode banding)", w: 24, fmt: FMT_INT },
    { h: "Rasio tagih/lapor (periode banding)", w: 26, fmt: FMT_3D },
    { h: "Bulan tertagih", w: 14, fmt: FMT_INT },
    { h: "Pola tagih datar", w: 16 }, { h: "Status penagihan (seluruh periode)", w: 28 },
  ]);
  for (const r of alat) {
    s1.addRow([
      r.faskes ?? r.customer_raw, r.kota, r.skema, num(r.account_id), r.customer_raw,
      r.sn_key, r.sn_raw, r.nama_alat, r.type_alat,
      bulat(r.target_jumlah_tes), bulat(r.tes_alat_rentang), satuDesimal(r.rata_tes_rentang), num(r.capaian_rentang),
      num(r.alat_seskema_di_customer), bulat(r.tes_faskes_rentang),
      bulat(r.revenue_rentang), bulat(r.rp_per_tes_rentang),
      yaTidak(r.basis_tes_memadai), num(r.porsi_kso), yaTidak(r.revenue_tumpang_tindih),
      bulat(r.tes_sheet_periode_banding), bulat(r.tes_ditagihkan_accurate), num(r.rasio_tagih_lapor),
      num(r.bulan_tertagih_accurate), yaTidak(r.tagih_pola_datar), r.status_penagihan,
    ]);
  }

  // ── Sheet: Reagen keluar ────────────────────────────────────────────────────────
  // Kolom "Masuk revenue skema" + "Alasan di luar skema" DIIKUTKAN, bukan opsional:
  // tanpa itu orang menjumlahkan kolom Nilai netto dan mendapat angka yang tak cocok
  // dengan revenue — cacat #1023 yang berpindah dari layar ke berkas.
  const s2 = wb.addWorksheet("Reagen keluar");
  pasangHeader(s2, [
    { h: "Faskes", w: 38 }, { h: "Account ID", w: 12, fmt: FMT_INT }, { h: "Periode", w: 12 },
    { h: "Kode item", w: 14 }, { h: "Item", w: 46 }, { h: "Jenis alat", w: 20 },
    { h: "Kategori", w: 16 }, { h: "Satuan", w: 10 },
    { h: "Qty", w: 12, fmt: FMT_1D }, { h: "Nilai netto", w: 18, fmt: FMT_RP },
    { h: "Jumlah faktur", w: 14, fmt: FMT_INT },
    // "Alasan pengecualian", BUKAN "Alasan di luar skema": header lama memuat kata
    // "skema" yang juga ada di "Masuk revenue skema", dan pencarian header (skrip
    // pemeriksa, atau orang yang memfilter kolom) mengambil yang salah. Sudah kejadian
    // saat berkas prod diverifikasi 2026-08-24. Nama kolom yang saling memuat kata
    // pembeda adalah jebakan yang tidak memunculkan error.
    { h: "Masuk revenue skema", w: 20 }, { h: "Alasan pengecualian", w: 32 },
  ]);
  for (const r of reagen) {
    s2.addRow([
      r.faskes ?? "(faskes tak terpetakan)", num(r.account_id), String(r.periode).slice(0, 7),
      r.item_no, r.item_nama, r.jenis_alat, r.kategori, r.unit,
      num(r.qty), bulat(r.nilai_netto_skema), num(r.jumlah_faktur),
      r.dalam_skema ? "ya" : "",
      r.dalam_skema ? "" : (r.penagihan_tes ? "penagihan tes — alat tak dimiliki" : "kategori tak berlaku"),
    ]);
  }

  // ── Sheet: Tes & revenue bulanan ────────────────────────────────────────────────
  const s3 = wb.addWorksheet("Tes & revenue bulanan");
  pasangHeader(s3, [
    { h: "Faskes", w: 38 }, { h: "Account ID", w: 12, fmt: FMT_INT }, { h: "Periode", w: 12 },
    { h: "Tes dilaporkan", w: 16, fmt: FMT_INT }, { h: "Alat melapor", w: 14, fmt: FMT_INT },
    { h: "Revenue netto", w: 18, fmt: FMT_RP },
  ]);
  for (const r of bulanan) {
    s3.addRow([
      r.faskes ?? "(faskes tak terpetakan)", num(r.account_id), String(r.periode).slice(0, 7),
      bulat(r.jumlah_tes), num(r.alat_lapor), bulat(r.revenue_netto),
    ]);
  }

  // ── Sheet: Keterangan ───────────────────────────────────────────────────────────
  // Bukan hiasan. Berkas ini akan beredar lepas dari layarnya, dan tiga hal di dalamnya
  // sudah terbukti disalahbaca saat masih di layar: cakupan periode, baris yang tidak
  // masuk revenue, dan beda "dilaporkan" vs "ditagihkan". Menjelaskannya di dalam berkas
  // lebih murah daripada menjawabnya berulang.
  const s4 = wb.addWorksheet("Keterangan");
  s4.columns = [{ header: "Hal", width: 34 }, { header: "Penjelasan", width: 110 }];
  s4.getRow(1).font = { bold: true };
  const ket: Array<[string, string]> = [
    ["Skema", skema],
    ["Rentang periode", `${dari.slice(0, 7)} s/d ${sampai.slice(0, 7)}`],
    ["CAKUPAN", `SEMUA sheet dibatasi rentang di atas (keputusan user 2026-08-24). Sigma 'Revenue netto' di sheet Tes & revenue bulanan = kolom 'Revenue netto faskes' di sheet Produktivitas per alat = Sigma 'Nilai netto' baris ber-'ya' di sheet Reagen keluar.`],
    ["KECUALI 4 kolom berlabel", `Kolom yang headernya menyebut '(seluruh periode)' atau '(periode banding)' TIDAK mengikuti rentang, karena definisinya bukan per-rentang: Porsi KSO ditetapkan atas seluruh data; Penyebut memadai ambangnya 100 tes per TAHUN; Rasio tagih/lapor & Tes ditagihkan memakai basis 'periode banding' sendiri. Memaksanya ikut rentang berarti besaran baru yang kebetulan bernama sama.`],
    ["Sheet Produktivitas per alat", "Satu baris per ALAT. Kolom 'Tes alat ini/Target/Rata/Capaian' milik alat itu; kolom 'Tes faskes/Revenue/Rp per tes' milik FASKES dan berulang di tiap alat milik faskes yang sama."],
    ["Sheet Reagen keluar", "Satu baris per faskes x bulan x item x kategori x satuan, dibatasi rentang di atas. Nilai sudah dikali porsi KSO untuk faskes berskema ganda."],
    ["Kolom 'Masuk revenue skema'", "Hanya baris ber-'ya' yang dijumlahkan menjadi Revenue netto. Menjumlahkan seluruh kolom Nilai netto TIDAK akan cocok dengan Revenue."],
    ["Alasan 'alat tak dimiliki'", "Penagihan per-tes untuk jenis alat yang tidak ada di master aset faskes ini pada skema ini — karena itu tidak diakui sebagai revenue skema."],
    ["Tes dilaporkan vs ditagihkan", "Dua sumber berbeda: 'dilaporkan' dari sheet KSO (diisi teknisi), 'ditagihkan' dari qty baris PEMERIKSAAN di faktur Accurate. Selisihnya wajar diperiksa, bukan tanda data rusak."],
    ["Rp per tes", "Hanya bermakna pada skema PER_TEST. Di BELI_REAGEN hanya 4 dari 329 alat melaporkan tes, jadi penyebutnya praktis tidak ada."],
    ["Penyebut memadai", "Kosong = total tes seskema di bawah 100/tahun. Jangan dipakai memeringkat: Rp/tes meledak saat penyebutnya nyaris nol."],
    ["Revenue netto", "Netto tanpa PPN, dialokasikan proporsional per baris faktur. Nilainya dibulatkan ke rupiah."],
    ["Selisih beberapa rupiah antar sheet", "WAJAR, dan bukan tanda data rusak. Rupiah dibulatkan PER SEL supaya kolomnya bisa dijumlahkan di Excel tanpa sen. Sheet Reagen punya jauh lebih banyak baris daripada sheet Bulanan, jadi akumulasi pembulatannya berbeda. Terukur di prod 2026-08-24: Sigma Reagen 'ya' Rp 11.121.560.267 vs Sigma Revenue bulanan Rp 11.121.560.234 — selisih Rp 33 dari Rp 11,1 miliar (0,0000003%), sementara di database selisihnya NOL eksak. Kalau selisihnya jauh lebih besar dari itu, barulah ada yang perlu diperiksa."],
  ];
  for (const [a, b] of ket) s4.addRow([a, b]);
  s4.getColumn(2).alignment = { wrapText: true, vertical: "top" };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function ksoWorkbookFilename(opts: KsoExportOpts): string {
  const s = opts.skema.toLowerCase();
  return `kso-produktivitas-${s}-${opts.dari.slice(0, 7)}-sd-${opts.sampai.slice(0, 7)}.xlsx`;
}
