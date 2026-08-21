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
// account_id sengaja dibiarkan NULL di sini. Nama customer di sheet berformat
// "<nama>, <tipe> <KOTA>" dan tidak identik dengan accurate_customer.name; pencocokannya
// butuh langkah terpisah yang bisa ditinjau, bukan fuzzy match diam-diam saat impor.

import { readFileSync } from "node:fs";
import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");
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

  let nAsset = 0;
  for (const bagian of potong(assets)) {
    const baris = bagian.map((a) => ({
      sn_key: a.sn_key,
      sn_raw: a.sn_raw ?? null,
      customer_raw: a.customer_raw,
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
