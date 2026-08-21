#!/usr/bin/env node
// F67 — backfill `accurate_invoice.lunas_at` dari tanggal pembayaran ASLI di `raw`.
//
// KENAPA PERLU: migrasi 094 hanya bisa menstempel lunas_at saat sync MENGAMATI invoice
// berpindah OPEN -> PAID. Invoice yang sudah lunas sebelum kolomnya ada dibiarkan NULL,
// dan NULL diperlakukan CF netral 1,00 (repo/insentif.ts: `agingDays: r.aging_days ?? 30`).
// Netral itu pilihan yang jujur, TAPI bukan yang benar kalau tanggalnya sebenarnya ada.
//
// Komentar migrasi 094 menyisakan pintu ini: "kalau nanti terbukti raw dari Accurate
// memuat tanggal pembayaran sungguhan, kolom ini bisa di-backfill dan jadi presisi."
// Diperiksa di prod 2026-08-10: TERBUKTI. 3.594/3.594 invoice punya `raw`, dan
// `lastPaymentDate` terisi pada 1.915 dari 2.027 invoice berstatus Lunas (94,5%).
//
// DAMPAK RUPIAH (kenapa ini bukan kosmetik): dari 1.915 baris itu, 190 ber-aging >90 hari
// (CF 0,50) dan 149 ber-aging <=10 hari (CF 1,05). Tanpa backfill semuanya dapat 1,00 —
// artinya 190 orang KELEBIHAN bayar dan 149 KEKURANGAN bayar. Backfill mengoreksi dua arah,
// jadi harus mendarat SEBELUM pembayaran pertama.
//
// TIGA JEBAKAN yang dijaga di sini:
//   1. Format `dd/MM/yyyy`. Contoh nyata "25/06/2026". Parsing sebagai MM/DD menggeser umur
//      berbulan-bulan dan menyalahkan tier CF. to_date(...,'DD/MM/YYYY') TIDAK error untuk
//      "32/13/2026" (Postgres menggulung), jadi ada pagar regex + pagar rentang.
//   2. Pembayaran PARSIAL. Untuk invoice yang belum lunas, `lastPaymentDate` = pembayaran
//      TERAKHIR, bukan pelunasan. Di prod ada 8 baris begitu. Dikecualikan, dan dilaporkan.
//   3. lunas_at yang SUDAH terisi tidak ditimpa (WHERE lunas_at IS NULL) — hasil pengamatan
//      sync yang sudah berjalan biarkan apa adanya; skrip ini hanya mengisi yang kosong.
//
// KETELITIAN SETELAH BACKFILL: campuran dua sumber — baris hasil backfill = tanggal
// pembayaran sungguhan (presisi), baris hasil pengamatan sync = meleset <= 3 hari. Tidak ada
// penanda yang membedakan keduanya setelah tertulis; untuk tabel CF yang tingkat pertamanya
// 0-10 hari, campuran itu memadai. Kalau suatu saat perlu dibedakan, tambahkan kolom sumber
// lewat migrasi, JANGAN menebak dari data.
//
// Pakai (WAJIB build dulu — skrip ini memakai apps/api/dist, sama seperti insentif-seed-tier.mjs):
//   pnpm --filter @wrg/api build
//   node scripts/ops/insentif-backfill-lunas-at.mjs           # pratinjau, tak menulis
//   node scripts/ops/insentif-backfill-lunas-at.mjs --apply   # tulis
//
// DATABASE_URL menentukan target — tidak ada default dan tidak ada flag --db, supaya tak ada
// yang menulis ke prod karena lupa. Untuk prod: jalankan dari /Users/development/DevWRG/wrg-os
// dengan DATABASE_URL dari .env.prod.

import { db } from "../../apps/api/dist/db.js";

const APPLY = process.argv.includes("--apply");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL belum di-set.");
  process.exit(1);
}
const sql = db();

// Satu definisi kandidat, dipakai pratinjau MAUPUN penulisan — supaya angka yang
// ditampilkan dry-run persis baris yang nanti ter-update.
//
// FUNGSI, bukan konstanta: fragmen postgres.js tidak boleh dipakai di dua query berbeda
// (satu objek Query = satu eksekusi). Tiap pemanggilan menghasilkan fragmen baru.
const kandidat = () => sql`
  SELECT ai.id, ai.tanggal,
         to_date(ai.raw->>'lastPaymentDate', 'DD/MM/YYYY') AS bayar
  FROM accurate_invoice ai
  WHERE ai.lunas_at IS NULL
    AND ai.raw->>'statusName' = 'Lunas'
    AND ai.raw->>'lastPaymentDate' ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4}$'`;

try {
  const [ringkas] = await sql`
    WITH k AS (${kandidat()})
    SELECT
      count(*)::int AS kandidat,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE)::int AS sah,
      count(*) FILTER (WHERE bayar < tanggal)::int AS negatif,
      count(*) FILTER (WHERE bayar > CURRENT_DATE)::int AS masa_depan,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE
                         AND bayar - tanggal <= 10)::int AS cf_105,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE
                         AND bayar - tanggal > 10 AND bayar - tanggal <= 30)::int AS cf_100,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE
                         AND bayar - tanggal > 30 AND bayar - tanggal <= 60)::int AS cf_090,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE
                         AND bayar - tanggal > 60 AND bayar - tanggal <= 90)::int AS cf_075,
      count(*) FILTER (WHERE bayar >= tanggal AND bayar <= CURRENT_DATE
                         AND bayar - tanggal > 90)::int AS cf_050
    FROM k`;

  // Konteks: apa yang TETAP tak diketahui setelah backfill, dan apa yang sengaja dilewati.
  const [sisa] = await sql`
    SELECT
      count(*) FILTER (WHERE raw->>'statusName' = 'Lunas'
                         AND raw->>'lastPaymentDate' IS NULL)::int AS lunas_tanpa_tanggal,
      count(*) FILTER (WHERE raw->>'statusName' <> 'Lunas'
                         AND raw->>'lastPaymentDate' IS NOT NULL)::int AS parsial_dikecualikan,
      count(*) FILTER (WHERE lunas_at IS NOT NULL)::int AS sudah_terisi,
      count(*) FILTER (WHERE raw IS NULL)::int AS tanpa_raw
    FROM accurate_invoice`;

  // Silang-cek label Accurate vs definisi LUNAS milik repo (repo/insentif.ts memakai
  // outstanding IS NOT NULL AND outstanding <= 0). Kalau dua-duanya tak sepakat, yang
  // dihitung insentif dan yang di-backfill bisa berbeda himpunan — itu wajib kelihatan.
  const [silang] = await sql`
    SELECT
      count(*) FILTER (WHERE raw->>'statusName' = 'Lunas'
                         AND NOT (outstanding IS NOT NULL AND outstanding <= 0))::int AS label_lunas_mirror_belum,
      count(*) FILTER (WHERE raw->>'statusName' <> 'Lunas'
                         AND (outstanding IS NOT NULL AND outstanding <= 0))::int AS mirror_lunas_label_belum
    FROM accurate_invoice WHERE raw IS NOT NULL`;

  const n = (v) => Number(v ?? 0).toLocaleString("id-ID");

  console.log(`\nBackfill lunas_at — ${APPLY ? "APPLY" : "PRATINJAU"}\n`);
  console.log(`  kandidat (Lunas, ada tanggal, lunas_at masih NULL) : ${n(ringkas.kandidat)}`);
  console.log(`  akan ditulis (tanggal sah)                         : ${n(ringkas.sah)}`);
  if (ringkas.negatif > 0 || ringkas.masa_depan > 0) {
    console.log(`  ⚠️  dilewati — bayar < terbit                       : ${n(ringkas.negatif)}`);
    console.log(`  ⚠️  dilewati — bayar > hari ini                     : ${n(ringkas.masa_depan)}`);
    console.log("      Dua-duanya tanda format/data ganjil. Diperiksa, jangan ditebak.");
  }

  console.log("\n  Sebaran CF setelah backfill (dari yang akan ditulis):");
  console.log(`    0-10 hari   CF 1,05  : ${n(ringkas.cf_105)}`);
  console.log(`    10-30 hari  CF 1,00  : ${n(ringkas.cf_100)}`);
  console.log(`    30-60 hari  CF 0,90  : ${n(ringkas.cf_090)}`);
  console.log(`    60-90 hari  CF 0,75  : ${n(ringkas.cf_075)}`);
  console.log(`    >90 hari    CF 0,50  : ${n(ringkas.cf_050)}`);
  console.log("    (Tanpa backfill, SEMUA baris di atas dapat CF 1,00.)");

  console.log("\n  Tetap NULL / di luar jangkauan:");
  console.log(`    Lunas tapi raw tak punya lastPaymentDate : ${n(sisa.lunas_tanpa_tanggal)}  -> CF netral 1,00`);
  console.log(`    Belum lunas tapi punya tanggal (parsial) : ${n(sisa.parsial_dikecualikan)}  -> DIKECUALIKAN, jebakan #2`);
  console.log(`    lunas_at sudah terisi (hasil sync)       : ${n(sisa.sudah_terisi)}  -> tidak ditimpa`);
  console.log(`    tanpa raw                                : ${n(sisa.tanpa_raw)}`);

  if (silang.label_lunas_mirror_belum > 0 || silang.mirror_lunas_label_belum > 0) {
    console.log("\n  ⚠️  Label Accurate vs definisi LUNAS repo tidak sepakat:");
    console.log(`      raw 'Lunas' tapi outstanding > 0 / NULL : ${n(silang.label_lunas_mirror_belum)}`);
    console.log(`      outstanding <= 0 tapi raw bukan 'Lunas' : ${n(silang.mirror_lunas_label_belum)}`);
    console.log("      Baris begini di-backfill tapi belum tentu ikut dihitung insentif (atau sebaliknya).");
    console.log("      Bukan penghalang backfill — tapi cek kesegaran mirror sebelum periode dikunci.");
  }

  if (!APPLY) {
    console.log("\nDRY-RUN. Tambahkan --apply untuk menulis.\n");
    process.exit(0);
  }

  // Pagar rentang diulang di UPDATE, bukan hanya di pratinjau — supaya baris ganjil tak
  // ikut tertulis kalau data berubah antara pratinjau dan apply.
  const res = await sql`
    UPDATE accurate_invoice ai
    SET lunas_at = k.bayar
    FROM (${kandidat()}) k
    WHERE ai.id = k.id
      AND k.bayar >= k.tanggal
      AND k.bayar <= CURRENT_DATE`;

  console.log(`\n✅ ${n(res.count)} baris ter-update.\n`);
  console.log("Langkah lanjut: hitung ulang periode yang terpengaruh —");
  console.log("  POST /insentif/compute?periode=YYYY-MM  (apply=false dulu untuk pratinjau)");
  console.log("Tanpa hitung ulang, insentif_transaksi masih menyimpan CF lama yang netral.\n");
} finally {
  await sql.end();
}
