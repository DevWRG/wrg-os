#!/usr/bin/env node
// Impor JSON hasil `kso-sheet-to-json.py` ke tabel migrasi 097
// (kso_asset, kso_asset_test_monthly, kso_asset_param_monthly).
//
// DEFAULT DRY-RUN. Tanpa --apply skrip ini tidak menulis apa pun: ia menghitung berapa
// baris yang akan disisipkan/diperbarui, lalu mencetak ringkasan + daftar konflik.
// Pola yang sama dengan insentif-seed-tier.mjs — data KSO ini dipakai untuk menilai
// produktivitas aset, jadi salah impor diam-diam lebih mahal daripada gagal berisik.
//
// PAKAI:
//   pnpm --filter @wrg/api build                              # skrip memakai dist/db.js
//   python3 scripts/ops/kso-sheet-to-json.py <xlsx> --out ~/kso-import.json
//   node scripts/ops/kso-asset-import.mjs --file ~/kso-import.json           # pratinjau
//   node scripts/ops/kso-asset-import.mjs --file ~/kso-import.json --apply   # tulis
//
// SIFAT UPSERT (idempoten, aman diulang):
//   • kso_asset di-upsert by sn_key. Kolom yang diisi manual di aplikasi — `pemilik_alat`
//     dan `account_id` — SENGAJA TIDAK PERNAH DITIMPA oleh impor. Kalau ditimpa, satu kali
//     re-import akan menghapus semua kerja klasifikasi kepemilikan alat yang sudah dilakukan.
//   • kso_asset_test_monthly & _param_monthly di-upsert by PK. Bulan yang selnya kosong di
//     sheet TIDAK dikirim, jadi angka lama tidak akan ter-NULL-kan oleh sheet yang belum
//     terisi sampai akhir tahun.
//
// MODE POPULASI-SAJA (JSON dari `kso-sheet-to-json.py --populasi-saja`, `mode: "populasi_saja"`):
//   Hanya kolom milik sheet Populasi yang ditimpa (customer, MOU, target, paket, nama alat,
//   dst.). `skema`, `station`, `admin`, dan `catatan_sync` aset lama TIDAK disentuh — di
//   impor penuh nilainya datang dari sheet Tes/Reagent 2026, yang di mode ini tidak dibaca;
//   menimpanya dengan STATUS populasi membalik skema yang sudah benar. `skema` hanya diisi
//   untuk aset baru, atau aset lama yang skemanya masih UNKNOWN. Label sheet 2026 di
//   `sumber_sheet` dipertahankan. Populasi dianggap DAFTAR LENGKAP: aset yang
//   `in_populasi=true` di DB tapi tak ada di berkas ditandai `in_populasi=false`. Tes
//   bulanan & parameter tidak disentuh. Semua tulisan dalam satu transaksi.
//
// PINDAH FASKES (migrasi 217, F169). Kolom Customer yang berubah TIDAK lagi ditimpa
// begitu saja — itu memindahkan seluruh riwayat tes alat ke faskes baru. Tiap
// perubahan customer aset lama digolongkan:
//   • pindah   — TGL SJ di sheet ikut berubah dan terbaca sebagai tanggal (≤ hari ini,
//                sesudah tanggal masuk penempatan sekarang). Dicatat lewat
//                kso_pindahkan_alat(): penempatan lama ditutup per TGL SJ, yang baru
//                dibuka. account_id tujuan dari kso_customer_map (NULL kalau belum
//                terpeta — isi lewat kso-account-match.mjs).
//   • koreksi  — nama lama & baru terpeta ke account_id yang SAMA, atau SN disebut di
//                --anggap-koreksi SN1,SN2. Ejaan dibetulkan, riwayat tak berubah.
//   • tertahan — selain itu. Customer di DB DIBIARKAN, dicetak untuk ditinjau: catat
//                lewat menu (Riwayat Alat → Catat pindah) atau betulkan TGL SJ di sheet.
// Alat BARU: tanggal masuk penempatannya diisi dari TGL SJ kalau terbaca.
//
// account_id sengaja dibiarkan NULL di sini. Nama customer di sheet berformat
// "<nama>, <tipe> <KOTA>" dan tidak identik dengan accurate_customer.name; pencocokannya
// butuh langkah terpisah yang bisa ditinjau, bukan fuzzy match diam-diam saat impor.

import { readFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
const PAKSA = process.argv.includes("--paksa");
const koreksiIdx = process.argv.indexOf("--anggap-koreksi");
const ANGGAP_KOREKSI = new Set(
  koreksiIdx > -1 ? String(process.argv[koreksiIdx + 1] ?? "").split(",").map((x) => x.trim()).filter(Boolean) : []);
const fileIdx = process.argv.indexOf("--file");
const FILE = fileIdx > -1 ? process.argv[fileIdx + 1] : null;

if (!FILE) {
  console.error("Pakai: node scripts/ops/kso-asset-import.mjs --file <path.json> [--apply]");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(FILE, "utf8"));
const assets = payload.assets ?? [];
const tests = payload.tests ?? [];
const params = payload.params ?? [];
const POPULASI_SAJA = payload.mode === "populasi_saja";
const LABEL_POPULASI = ["Populasi KSO", "Populasi Alat"];
// Kolom yang sumbernya sheet Populasi — satu-satunya yang ditimpa di mode populasi-saja.
const KOLOM_POPULASI = [
  "sn_raw", "customer_raw", "kota", "type_alat", "nama_alat", "nomor_mou",
  "mou_berlaku_sampai", "target_jumlah_tes", "ritme_kunjungan", "paket",
  "status_sheet", "keterangan", "tgl_sj", "alamat", "outlet",
];

if (!assets.length) {
  console.error("JSON tidak memuat `assets`. Salah file?");
  process.exit(1);
}

const sql = db();
const CHUNK = 500;
const potong = (arr) =>
  Array.from({ length: Math.ceil(arr.length / CHUNK) }, (_, i) =>
    arr.slice(i * CHUNK, (i + 1) * CHUNK));

try {
  const [{ ada }] = await sql`
    SELECT count(*)::int AS ada FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kso_asset'`;
  if (!ada) {
    console.error("Tabel kso_asset belum ada. Terapkan infra/postgres/init/097_kso_asset.sql dulu.");
    process.exit(1);
  }

  if (POPULASI_SAJA) {
    await imporPopulasiSaja();
    process.exit(0);
  }

  const sebelum = await sql`SELECT count(*)::int AS n FROM kso_asset`;
  const kunciAda = new Set(
    (await sql`SELECT sn_key FROM kso_asset`).map((r) => r.sn_key));
  const baru = assets.filter((a) => !kunciAda.has(a.sn_key)).length;

  console.log("=== Ringkasan sumber ===");
  console.log(JSON.stringify(payload.report?.total ?? {}, null, 2));
  console.log(`\n=== Rencana tulis ===`);
  console.log(`  kso_asset             : ${assets.length} baris (${baru} baru, ${assets.length - baru} update)`);
  console.log(`  kso_asset_test_monthly: ${tests.length} baris`);
  console.log(`  kso_asset_param_month : ${params.length} baris`);
  console.log(`  sudah ada di DB       : ${sebelum[0].n} aset`);

  const rencana = await rencanaPenempatan(assets);
  cetakRencanaPenempatan(rencana);

  const konflik = assets.filter((a) => a.catatan_sync);
  console.log(`\n=== Aset dengan catatan sinkronisasi: ${konflik.length} ===`);
  for (const a of konflik.slice(0, 20)) {
    console.log(`  ${a.sn_key.padEnd(20)} ${String(a.customer_raw).slice(0, 40).padEnd(42)} ${a.catatan_sync}`);
  }
  if (konflik.length > 20) console.log(`  ... dan ${konflik.length - 20} lagi`);

  if (!APPLY) {
    console.log("\nDRY-RUN. Tidak ada yang ditulis. Tambahkan --apply untuk mengeksekusi.");
    process.exit(0);
  }

  await terapkanPindah(sql, rencana);
  let nAsset = 0;
  for (const bagian of potong(assets)) {
    const baris = bagian.map((a) => ({
      sn_key: a.sn_key,
      sn_raw: a.sn_raw ?? null,
      customer_raw: rencana.customerTulis.get(a.sn_key) ?? a.customer_raw,
      kota: a.kota ?? null,
      station: a.station ?? null,
      admin: a.admin ?? null,
      type_alat: a.type_alat ?? null,
      nama_alat: a.nama_alat ?? null,
      skema: a.skema,
      nomor_mou: a.nomor_mou ?? null,
      mou_berlaku_sampai: a.mou_berlaku_sampai ?? null,
      target_jumlah_tes: a.target_jumlah_tes ?? null,
      ritme_kunjungan: a.ritme_kunjungan ?? null,
      paket: a.paket ?? null,
      status_sheet: a.status_sheet ?? null,
      keterangan: a.keterangan ?? null,
      tgl_sj: a.tgl_sj ?? null,
      alamat: a.alamat ?? null,
      outlet: a.outlet ?? null,
      in_populasi: a.in_populasi,
      sumber_sheet: a.sumber_sheet ?? [],
      catatan_sync: a.catatan_sync ?? null,
    }));
    // `pemilik_alat` dan `account_id` tidak ada di daftar kolom -> tidak pernah tersentuh.
    await sql`
      INSERT INTO kso_asset ${sql(baris)}
      ON CONFLICT (sn_key) DO UPDATE SET
        sn_raw             = EXCLUDED.sn_raw,
        customer_raw       = EXCLUDED.customer_raw,
        kota               = EXCLUDED.kota,
        station            = EXCLUDED.station,
        admin              = EXCLUDED.admin,
        type_alat          = EXCLUDED.type_alat,
        nama_alat          = EXCLUDED.nama_alat,
        skema              = EXCLUDED.skema,
        nomor_mou          = EXCLUDED.nomor_mou,
        mou_berlaku_sampai = EXCLUDED.mou_berlaku_sampai,
        target_jumlah_tes  = EXCLUDED.target_jumlah_tes,
        ritme_kunjungan    = EXCLUDED.ritme_kunjungan,
        paket              = EXCLUDED.paket,
        status_sheet       = EXCLUDED.status_sheet,
        keterangan         = EXCLUDED.keterangan,
        tgl_sj             = EXCLUDED.tgl_sj,
        alamat             = EXCLUDED.alamat,
        outlet             = EXCLUDED.outlet,
        in_populasi        = EXCLUDED.in_populasi,
        sumber_sheet       = EXCLUDED.sumber_sheet,
        catatan_sync       = EXCLUDED.catatan_sync,
        updated_at         = now()`;
    nAsset += bagian.length;
  }

  await isiTanggalMasukBaru(sql, rencana);
  const idOf = new Map(
    (await sql`SELECT id, sn_key FROM kso_asset`).map((r) => [r.sn_key, Number(r.id)]));

  let nTes = 0;
  for (const bagian of potong(tests)) {
    const baris = bagian
      .filter((t) => idOf.has(t.sn_key))
      .map((t) => ({
        asset_id: idOf.get(t.sn_key),
        periode: t.periode,
        jumlah_tes: t.jumlah_tes,
        sumber_sheet: t.sumber_sheet,
      }));
    if (!baris.length) continue;
    await sql`
      INSERT INTO kso_asset_test_monthly ${sql(baris)}
      ON CONFLICT (asset_id, periode) DO UPDATE SET
        jumlah_tes   = EXCLUDED.jumlah_tes,
        sumber_sheet = EXCLUDED.sumber_sheet,
        imported_at  = now()`;
    nTes += baris.length;
  }

  let nParam = 0;
  for (const bagian of potong(params)) {
    const baris = bagian
      .filter((p) => idOf.has(p.sn_key))
      .map((p) => ({
        asset_id: idOf.get(p.sn_key),
        periode: p.periode,
        parameter: p.parameter,
        jumlah_tes: p.jumlah_tes ?? null,
        sumber_sheet: p.sumber_sheet,
      }));
    if (!baris.length) continue;
    await sql`
      INSERT INTO kso_asset_param_monthly ${sql(baris)}
      ON CONFLICT (asset_id, periode, parameter) DO UPDATE SET
        jumlah_tes   = EXCLUDED.jumlah_tes,
        sumber_sheet = EXCLUDED.sumber_sheet,
        imported_at  = now()`;
    nParam += baris.length;
  }

  console.log(`\nSELESAI. aset=${nAsset} tes_bulanan=${nTes} parameter=${nParam}`);
  console.log("Langkah berikutnya: isi `pemilik_alat` (WRG/PRINCIPAL/CUSTOMER) dan petakan `account_id` ke accurate_customer.");
} finally {
  await sql.end({ timeout: 5 });
}

async function imporPopulasiSaja() {
  const dbRows = await sql`
    SELECT sn_key, sn_raw, customer_raw, kota, type_alat, nama_alat, nomor_mou,
           mou_berlaku_sampai::text AS mou_berlaku_sampai, target_jumlah_tes,
           ritme_kunjungan, paket, status_sheet, keterangan, tgl_sj, alamat, outlet,
           in_populasi, skema, sumber_sheet
      FROM kso_asset`;
  const diDb = new Map(dbRows.map((r) => [r.sn_key, r]));
  const diBerkas = new Set(assets.map((a) => a.sn_key));
  const nPopulasiDb = dbRows.filter((r) => r.in_populasi).length;

  // Berkas populasi yang terpotong (sheet salah, filter aktif saat ekspor) akan
  // mengeluarkan ratusan aset dari populasi sekaligus. Lebih baik berhenti.
  if (assets.length < nPopulasiDb * 0.9 && !PAKSA) {
    console.error(`Berkas cuma memuat ${assets.length} aset, DB punya ${nPopulasiDb} in_populasi. ` +
      "Terlalu sedikit — berkas terpotong? Tambahkan --paksa kalau memang benar.");
    process.exit(1);
  }

  const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());
  const baru = assets.filter((a) => !diDb.has(a.sn_key));
  const ubahPerKolom = Object.fromEntries(KOLOM_POPULASI.map((k) => [k, []]));
  let asetBerubah = 0;
  for (const a of assets) {
    const r = diDb.get(a.sn_key);
    if (!r) continue;
    let berubah = !r.in_populasi;
    for (const k of KOLOM_POPULASI) {
      if (norm(r[k]) !== norm(a[k])) {
        ubahPerKolom[k].push([a.sn_key, r[k], a[k]]);
        berubah = true;
      }
    }
    if (berubah) asetBerubah++;
  }
  const keluar = dbRows.filter((r) => r.in_populasi && !diBerkas.has(r.sn_key));
  const rencana = await rencanaPenempatan(assets);
  const skemaDiisi = assets.filter((a) => diDb.get(a.sn_key)?.skema === "UNKNOWN" && a.skema !== "UNKNOWN");

  console.log("=== MODE POPULASI-SAJA (tes bulanan, parameter, skema/station/admin aset lama tidak disentuh) ===");
  console.log(JSON.stringify(payload.report?.total ?? {}, null, 2));
  console.log(`\n=== Rencana tulis ===`);
  console.log(`  aset di berkas         : ${assets.length} (${baru.length} baru, ${assets.length - baru.length} sudah ada)`);
  console.log(`  aset lama yang berubah : ${asetBerubah}`);
  console.log(`  keluar dari populasi   : ${keluar.length} (in_populasi -> false)`);
  console.log(`  skema UNKNOWN diisi    : ${skemaDiisi.length}`);
  console.log(`  sudah ada di DB        : ${dbRows.length} aset (${nPopulasiDb} in_populasi)`);

  console.log("\n=== Perubahan per kolom (aset lama) ===");
  for (const [k, daftar] of Object.entries(ubahPerKolom)) {
    if (!daftar.length) continue;
    console.log(`  ${k}: ${daftar.length}`);
    for (const [sn, lama, b] of daftar.slice(0, 3)) {
      console.log(`      ${sn}: ${JSON.stringify(lama)} -> ${JSON.stringify(b)}`);
    }
  }
  console.log(`\n=== Aset baru: ${baru.length} ===`);
  for (const a of baru) {
    console.log(`  ${a.sn_key.padEnd(20)} ${String(a.customer_raw).slice(0, 45).padEnd(47)} ${a.nama_alat ?? ""} [${a.skema}]`);
  }
  console.log(`\n=== Keluar dari populasi: ${keluar.length} ===`);
  for (const r of keluar) {
    console.log(`  ${r.sn_key.padEnd(20)} ${String(r.customer_raw).slice(0, 45).padEnd(47)} ${r.nama_alat ?? ""} {${r.sumber_sheet.join(", ")}}`);
  }
  cetakRencanaPenempatan(rencana);

  if (!APPLY) {
    console.log("\nDRY-RUN. Tidak ada yang ditulis. Tambahkan --apply untuk mengeksekusi.");
    return;
  }

  await sql.begin(async (tx) => {
    await terapkanPindah(tx, rencana);
    for (const bagian of potong(assets)) {
      const baris = bagian.map((a) => ({
        sn_key: a.sn_key,
        ...Object.fromEntries(KOLOM_POPULASI.map((k) => [k, a[k] ?? null])),
        customer_raw: rencana.customerTulis.get(a.sn_key) ?? a.customer_raw,
        skema: a.skema,
        in_populasi: true,
        sumber_sheet: ["Populasi Alat"],
        catatan_sync: a.catatan_sync ?? null,
      }));
      // Baris baru: semua kolom dari berkas. Baris lama: hanya kolom populasi;
      // label sheet non-populasi di sumber_sheet dipertahankan.
      await tx`
        INSERT INTO kso_asset ${tx(baris)}
        ON CONFLICT (sn_key) DO UPDATE SET
          sn_raw             = EXCLUDED.sn_raw,
          customer_raw       = EXCLUDED.customer_raw,
          kota               = COALESCE(EXCLUDED.kota, kso_asset.kota),
          type_alat          = EXCLUDED.type_alat,
          nama_alat          = EXCLUDED.nama_alat,
          nomor_mou          = EXCLUDED.nomor_mou,
          mou_berlaku_sampai = EXCLUDED.mou_berlaku_sampai,
          target_jumlah_tes  = EXCLUDED.target_jumlah_tes,
          ritme_kunjungan    = EXCLUDED.ritme_kunjungan,
          paket              = EXCLUDED.paket,
          status_sheet       = EXCLUDED.status_sheet,
          keterangan         = EXCLUDED.keterangan,
          tgl_sj             = EXCLUDED.tgl_sj,
          alamat             = EXCLUDED.alamat,
          outlet             = EXCLUDED.outlet,
          skema              = CASE WHEN kso_asset.skema = 'UNKNOWN' THEN EXCLUDED.skema
                                    ELSE kso_asset.skema END,
          in_populasi        = true,
          sumber_sheet       = ARRAY['Populasi Alat']::text[] || ARRAY(
                                 SELECT s FROM unnest(kso_asset.sumber_sheet) s
                                  WHERE s <> ALL (${LABEL_POPULASI}::text[])),
          updated_at         = now()`;
    }
    if (keluar.length) {
      await tx`
        UPDATE kso_asset SET
          in_populasi  = false,
          sumber_sheet = ARRAY(SELECT s FROM unnest(sumber_sheet) s
                                WHERE s <> ALL (${LABEL_POPULASI}::text[])),
          updated_at   = now()
         WHERE sn_key = ANY (${keluar.map((r) => r.sn_key)}::text[])`;
    }
    await isiTanggalMasukBaru(tx, rencana);
  });
  const [{ n, pop }] = await sql`
    SELECT count(*)::int AS n, count(*) FILTER (WHERE in_populasi)::int AS pop FROM kso_asset`;
  console.log(`\nSELESAI. kso_asset=${n} (in_populasi=${pop}). Segarkan snapshot: bash scripts/ops/kso-mv-refresh.sh`);
}

// ── Penempatan (migrasi 217) ──────────────────────────────────────────────────────

// Fungsi, bukan const di level modul: blok ini berada di bawah kode top-level yang
// memakai await, jadi const di sini belum terinisialisasi saat dipanggil (TDZ).
function nomorBulan(nama) {
  return ({
    JAN: 1, JANUARI: 1, JANUARY: 1, FEB: 2, FEBRUARI: 2, FEBRUARY: 2, MAR: 3, MARET: 3, MARCH: 3,
    APR: 4, APRIL: 4, MEI: 5, MAY: 5, JUN: 6, JUNI: 6, JUNE: 6, JUL: 7, JULI: 7, JULY: 7,
    AGU: 8, AGS: 8, AGT: 8, AGUSTUS: 8, AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9,
    OKT: 10, OKTOBER: 10, OCT: 10, OCTOBER: 10, NOV: 11, NOPEMBER: 11, NOVEMBER: 11,
    DES: 12, DESEMBER: 12, DEC: 12, DECEMBER: 12,
  })[nama] ?? null;
}

// TGL SJ ditulis bebas di sheet: "01 JULI 2021", "13 April 2026", "2026-09-29 00:00:00"
// (sel tanggal asli dari xlsx). Tanggal bergaris miring ("11/21/2025", ekspor CSV) hanya
// diterima kalau tak ambigu — salah tebak hari/bulan = salah bulan atribusi tes.
// Hasil 'YYYY-MM-DD' atau null.
function tanggalSj(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase();
  let y, m, d;
  let x = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/);
  if (x) [y, m, d] = [Number(x[1]), Number(x[2]), Number(x[3])];
  else if ((x = s.match(/^(\d{1,2})[\s.-]+([A-Z]+)[\s.,-]+(\d{4})$/)) && nomorBulan(x[2])) {
    [d, m, y] = [Number(x[1]), nomorBulan(x[2]), Number(x[3])];
  } else if ((x = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) {
    const [a, b] = [Number(x[1]), Number(x[2])];
    if (a > 12 && b <= 12) [d, m] = [a, b];
    else if (b > 12 && a <= 12) [m, d] = [a, b];
    else return null;
    y = Number(x[3]);
  } else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function kunciCustomer(s) {
  return String(s ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}
function sama(a, b) {
  return String(a ?? "").trim().toUpperCase() === String(b ?? "").trim().toUpperCase();
}

async function rencanaPenempatan(daftar) {
  const [{ ada }] = await sql`
    SELECT count(*)::int AS ada FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'kso_asset_penempatan'`;
  if (!ada) {
    console.error("Tabel kso_asset_penempatan belum ada. Terapkan migrasi 217 dulu.");
    process.exit(1);
  }
  const db = new Map((await sql`
    SELECT a.id, a.sn_key, a.customer_raw, a.account_id, a.tgl_sj, p.mulai::text AS mulai
      FROM kso_asset a
      LEFT JOIN kso_asset_penempatan p ON p.asset_id = a.id AND p.selesai IS NULL`)
    .map((r) => [r.sn_key, r]));
  const peta = new Map((await sql`
    SELECT customer_key, account_id FROM kso_customer_map WHERE account_id IS NOT NULL`)
    .map((r) => [r.customer_key, Number(r.account_id)]));
  const hariIni = new Date().toISOString().slice(0, 10);

  const pindah = [], koreksi = [], tertahan = [], masuk = [];
  const customerTulis = new Map();
  for (const a of daftar) {
    const r = db.get(a.sn_key);
    if (!r) {
      const tgl = tanggalSj(a.tgl_sj);
      if (tgl && tgl <= hariIni) masuk.push({ sn_key: a.sn_key, tanggal: tgl });
      continue;
    }
    if (sama(r.customer_raw, a.customer_raw)) continue;
    const accLama = r.account_id === null ? null : Number(r.account_id);
    const accBaru = peta.get(kunciCustomer(a.customer_raw)) ?? null;
    const tgl = tanggalSj(a.tgl_sj);
    const sjBaru = !sama(r.tgl_sj, a.tgl_sj);
    const dasar = { sn_key: a.sn_key, id: Number(r.id), lama: r.customer_raw, baru: a.customer_raw,
      tgl_sj: a.tgl_sj ?? null, accLama, accBaru };
    if (ANGGAP_KOREKSI.has(a.sn_key) || (accBaru !== null && accBaru === accLama)) {
      koreksi.push(dasar);
    } else if (sjBaru && tgl && tgl <= hariIni && (!r.mulai || tgl > r.mulai)) {
      pindah.push({ ...dasar, tanggal: tgl });
    } else {
      const alasan = !sjBaru ? "TGL SJ tidak berubah"
        : !tgl ? `TGL SJ "${a.tgl_sj ?? ""}" tak terbaca sebagai tanggal`
        : tgl > hariIni ? `TGL SJ ${tgl} belum terjadi`
        : `TGL SJ ${tgl} tidak sesudah tanggal masuk ${r.mulai}`;
      tertahan.push({ ...dasar, alasan });
      customerTulis.set(a.sn_key, r.customer_raw);
    }
  }
  return { pindah, koreksi, tertahan, masuk, customerTulis };
}

function cetakRencanaPenempatan({ pindah, koreksi, tertahan, masuk }) {
  const nama = (s) => String(s ?? "").slice(0, 38).padEnd(40);
  console.log(`\n=== Pindah faskes (dicatat ke riwayat, tanggal = TGL SJ): ${pindah.length} ===`);
  for (const p of pindah) {
    console.log(`  ${p.sn_key.padEnd(18)} ${p.tanggal}  ${nama(p.lama)} -> ${nama(p.baru)}` +
      (p.accBaru === null ? " [faskes tujuan belum terpeta ke Accurate]" : ""));
  }
  console.log(`\n=== Koreksi nama (riwayat tetap): ${koreksi.length} ===`);
  for (const p of koreksi) console.log(`  ${p.sn_key.padEnd(18)} ${nama(p.lama)} -> ${nama(p.baru)}`);
  console.log(`\n=== TERTAHAN — customer di DB dibiarkan: ${tertahan.length} ===`);
  for (const p of tertahan) {
    console.log(`  ${p.sn_key.padEnd(18)} ${nama(p.lama)} -> ${nama(p.baru)} (${p.alasan})`);
  }
  if (tertahan.length) {
    console.log("  Pindah sungguhan → catat di menu Produktivitas KSO (Riwayat Alat) atau betulkan TGL SJ di sheet.");
    console.log("  Cuma beda ejaan → ulangi dengan --anggap-koreksi " + tertahan.map((p) => p.sn_key).join(","));
  }
  console.log(`\n=== Alat baru dengan tanggal masuk dari TGL SJ: ${masuk.length} ===`);
}

async function terapkanPindah(tx, { pindah }) {
  for (const p of pindah) {
    await tx`
      SELECT kso_pindahkan_alat(${p.id}, ${p.baru}, ${p.accBaru}, ${p.tanggal}::date, 'sheet',
        ${`Impor sheet Populasi Alat: TGL SJ "${p.tgl_sj}"`}, 'importer sheet')`;
  }
}

// Penempatan terbuka alat baru dibuat trigger tanpa tanggal; isi dari TGL SJ.
async function isiTanggalMasukBaru(tx, { masuk }) {
  for (const m of masuk) {
    await tx`
      UPDATE kso_asset_penempatan p SET mulai = ${m.tanggal}::date, sumber = 'sheet',
             catatan = 'Alat baru; tanggal masuk = TGL SJ di sheet Populasi Alat.'
        FROM kso_asset a
       WHERE a.id = p.asset_id AND a.sn_key = ${m.sn_key} AND p.selesai IS NULL AND p.mulai IS NULL
         AND NOT EXISTS (SELECT 1 FROM kso_asset_penempatan q WHERE q.asset_id = p.asset_id AND q.id <> p.id)`;
  }
}
