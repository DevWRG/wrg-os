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
export function joinAmFromSalesman(sql: Sql) {
  return sql`LEFT JOIN master_user mu ON mu.am_id = COALESCE(
      NULLIF(acs.master_user_id::text, ''),
      (SELECT s2.master_user_id::text FROM accurate_salesman s2
        WHERE s2.name = ai.salesman_name AND s2.master_user_id IS NOT NULL
        ORDER BY s2.id LIMIT 1))`;
}

// Label baris yang tak bisa diatribusikan ke AM mana pun. Sengaja BUKAN kode
// Accurate mentah: wilayah/akun itu memang sedang tanpa pemilik sampai ada
// sales/AM baru. Semua sisa tak-terpetakan melebur jadi satu baris ini.
export const AM_VACANT = "VACANT";
