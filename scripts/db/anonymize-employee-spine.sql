-- anonymize-employee-spine.sql — WAJIB dijalankan di environment DEMO setelah migrasi.
--
-- KENAPA: migrasi 053_seed_employee_spine.sql bukan DDL, melainkan 1.735 INSERT
-- berisi DATA KARYAWAN SUNGGUHAN — 53 orang, 50 nomor WhatsApp, kutipan pribadi,
-- OKR/KPI per orang — ke 11 tabel (employee, voice_item, bsc_objective,
-- okr_key_result, kpi, raci_assignment, employee_task, employee_tool,
-- pdca_cycle, bsc_weight, department). Migrasi itu jalan di SEMUA environment,
-- jadi DB demo pun langsung memuat PII walau tak pernah menyalin data prod.
--
-- Skrip ini menimpa kolom yang mengidentifikasi orang dengan nilai sintetis.
-- Struktur & jumlah baris dipertahankan supaya menu /npk, /bsc, /okr, /raci
-- tetap terlihat hidup.
--
-- CATATAN SISA RISIKO: primary key `employee.id` masih berupa slug nama panggilan
-- asli (mis. 'angga', 'abib') karena dirujuk 10 tabel lain lewat FK. Mengganti PK
-- perlu penulisan ulang seluruh referensi — dikerjakan terpisah kalau demo
-- dibuka ke publik.

BEGIN;

UPDATE employee SET
  nama          = 'Karyawan Demo ' || upper(left(id, 1)) || right(id, 2),
  panggilan     = 'Demo' || upper(left(id, 1)),
  whatsapp      = CASE WHEN whatsapp IS NULL THEN NULL
                       ELSE '62800000' || lpad((abs(hashtext(id)) % 9000 + 1000)::text, 4, '0') END,
  quote         = CASE WHEN quote IS NULL THEN NULL ELSE 'Kutipan contoh untuk demo.' END,
  okr_objective = CASE WHEN okr_objective IS NULL THEN NULL ELSE 'Objective contoh untuk demo.' END,
  atasan_raw    = CASE WHEN atasan_raw IS NULL THEN NULL ELSE 'Atasan Demo' END,
  lokasi        = CASE WHEN lokasi IS NULL THEN NULL ELSE 'Lokasi Demo' END,
  masa          = CASE WHEN masa IS NULL THEN NULL ELSE 'Sejak 20XX' END;

-- voice_item = keluhan/masukan verbatim per karyawan → paling sensitif.
UPDATE voice_item SET content = 'Catatan contoh (' || kind || ') untuk demo.';

COMMIT;

\echo 'Anonimisasi spine karyawan selesai (employee + voice_item).'
