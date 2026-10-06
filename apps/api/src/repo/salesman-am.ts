// Resolusi salesman Accurate → AM (master_user), satu definisi untuk semua
// query yang mengatribusikan faktur ke AM/cabang.
//
// Kenapa perlu dua lapis: sebagian faktur punya salesman_id yang tak menunjuk
// record accurate_salesman ber-master_user (record kode lama / kode dobel),
// tapi kolom teks ai.salesman_name-nya berisi KODE yang sebenarnya sudah
// ter-map (mis. "YGO" = Yugo/Muhammad Prayugo, "WDA", "CHS"). Tanpa fallback
// ini, faktur tsb jatuh ke grup tanpa-AM: muncul sebagai baris kode terpisah
// dari nama lengkap AM-nya, cabang kosong → region OFFICE, dan pada scope
// terbatas hilang dari data AM yang bersangkutan.
//
// Pola sm_map ini sebelumnya dikopi lokal di reportAr(); sekarang satu tempat.

import type { db } from "../db.js";

type Sql = ReturnType<typeof db>;

// JOIN master_user (alias `mu`). Query WAJIB sudah punya alias `ai`
// (accurate_invoice) + `acs` (accurate_salesman, join via ai.salesman_id).
// COALESCE dievaluasi lazy → subquery fallback hanya jalan untuk faktur yang
// salesman_id-nya memang tak nge-link.
//
// `mu.cabang` di sini = cabang AM PADA TANGGAL FAKTUR, bukan cabang sekarang
// (migrasi 193 am_cabang_riwayat). Aturan user 5 Okt 2026: mutasi sales tak
// boleh menggeser revenue area yang sudah terjadi — faktur Ari sebelum 10 Agu
// 2026 tetap BALI walau master_user.cabang-nya kini JAKARTA. AM tanpa riwayat
// mutasi jatuh ke master_user.cabang seperti dulu. Kolom lain `mu` identik
// dengan master_user (jsonb_populate_record cuma menimpa `cabang`), jadi semua
// pemakai mu.* (area, scope HoD, region) otomatis ikut tanpa diubah.
export function joinAmFromSalesman(sql: Sql) {
  return sql`LEFT JOIN LATERAL (
      SELECT (jsonb_populate_record(m0, jsonb_build_object('cabang', COALESCE(
        (SELECT r.cabang FROM am_cabang_riwayat r
          WHERE r.am_id = m0.am_id AND r.berlaku_mulai <= ai.tanggal
          ORDER BY r.berlaku_mulai DESC LIMIT 1),
        m0.cabang)))).*
      FROM master_user m0
      WHERE m0.am_id = COALESCE(
        NULLIF(acs.master_user_id::text, ''),
        (SELECT s2.master_user_id::text FROM accurate_salesman s2
          WHERE s2.name = ai.salesman_name AND s2.master_user_id IS NOT NULL
          ORDER BY s2.id LIMIT 1))
    ) mu ON true`;
}

// Label baris yang tak bisa diatribusikan ke AM mana pun. Sengaja BUKAN kode
// Accurate mentah: wilayah/akun itu memang sedang tanpa pemilik sampai ada
// sales/AM baru. Semua sisa tak-terpetakan melebur jadi satu baris ini.
export const AM_VACANT = "VACANT";

// Faktur ber-kode salesman OFFICE (house account) BUKAN vacant — keputusan user
// 5 Okt 2026: tampil sebagai OFFICE, terpisah dari VACANT. Kode dibaca dari
// acs.name (di mirror prod kolom name berisi KODE, number berisi nama — lihat
// catatan kolom tertukar) dengan fallback ai.salesman_name.
export const AM_OFFICE = "OFFICE";

export function isOfficeSql(sql: Sql) {
  return sql`(upper(COALESCE(NULLIF(acs.name,''), NULLIF(ai.salesman_name,''), '')) = 'OFFICE')`;
}

// Label pemilik per FAKTUR (bukan agregat): nama AM, atau OFFICE / VACANT.
// Literal, bukan parameter: ekspresi ini bisa ikut GROUP BY, dan parameter
// beda nomor ($1 vs $3) membuat Postgres tak mengenali ekspresi yang sama.
export function amLabelSql(sql: Sql) {
  return sql`COALESCE(NULLIF(mu.nama,''), CASE WHEN ${isOfficeSql(sql)} THEN 'OFFICE' ELSE 'VACANT' END)`;
}

// Kunci GROUP BY per pemilik: am_id, atau 'office' / 'tanpa' — supaya baris
// OFFICE dan VACANT tak melebur jadi satu grup am_id NULL.
export function amGroupKeySql(sql: Sql) {
  return sql`COALESCE(NULLIF(mu.am_id,''), CASE WHEN ${isOfficeSql(sql)} THEN 'office' ELSE 'tanpa' END)`;
}

// Cabang efektif (sudut pandang AREA) per faktur, tanpa fallback akhir.
// Faktur ber-AM → cabang AM pada tanggal faktur (lihat joinAmFromSalesman).
// Faktur tanpa AM (OFFICE / VACANT) → area LOKASI customer (migrasi 194
// area_customer: kota dari nama customer → area_kota, fallback cabang AM
// pemilik akun). Keputusan user 6 Okt 2026: Per Cabang tak boleh punya baris
// "Office" — OFFICE cuma label sales; cabang_override 'Office' sengaja
// diabaikan, override lain tetap dipakai sebagai cadangan terakhir.
export function cabangEffSql(sql: Sql) {
  return sql`COALESCE(NULLIF(mu.cabang,''), area_customer(ai.customer_id), NULLIF(NULLIF(acs.cabang_override,''),'Office'))`;
}

// Cabang yang ditampilkan di baris per-AM (sudut pandang SALES): cabang pada
// faktur TERAKHIR dalam rentang — mutasi baru berlaku sejak tanggalnya. Dulu
// max(mu.cabang), yang alfabetis dan tak peduli tanggal.
export function amCabangTerakhirSql(sql: Sql) {
  return sql`(array_agg(NULLIF(mu.cabang,'') ORDER BY ai.tanggal DESC) FILTER (WHERE NULLIF(mu.cabang,'') IS NOT NULL))[1]`;
}
