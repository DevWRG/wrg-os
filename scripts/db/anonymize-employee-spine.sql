-- anonymize-employee-spine.sql — WAJIB dijalankan di environment DEMO setelah migrasi.
--
-- KENAPA: migrasi 053_seed_employee_spine.sql bukan DDL, melainkan 1.735 INSERT
-- berisi DATA KARYAWAN SUNGGUHAN — 53 orang, 50 nomor WhatsApp, kutipan pribadi,
-- OKR/KPI per orang — ke 11 tabel (employee, voice_item, bsc_objective,
-- okr_key_result, kpi, raci_assignment, employee_task, employee_tool,
-- pdca_cycle, bsc_weight, department). Migrasi itu jalan di SEMUA environment,
-- jadi DB demo pun langsung memuat PII walau tak pernah menyalin data prod.
--
-- Skrip ini melakukan DUA hal:
--   1. Mengganti PRIMARY KEY employee.id — isinya slug nama panggilan asli
--      ('angga', 'abib', 'halim', …) — menjadi 'emp01'..'empNN'. Ini bukan
--      kosmetik: id itu ikut terekspos di payload API dan URL, jadi tanpa
--      penggantian ini nama panggilan 53 karyawan tetap terbaca publik.
--   2. Menimpa kolom yang mengidentifikasi orang (nama, WA, kutipan, OKR) dan
--      seluruh voice_item dengan nilai sintetis.
-- Jumlah baris & struktur dipertahankan supaya menu /npk, /bsc, /okr, /raci
-- tetap terlihat hidup.
--
-- 10 FK ke employee(id) semuanya NO ACTION (tanpa ON UPDATE CASCADE), jadi
-- penggantian id dikerjakan bertahap: sisipkan salinan ber-id baru → arahkan
-- semua tabel anak → hapus baris lama. Itu sebabnya urutannya tak boleh diubah.
--
-- Idempoten: id yang sudah berpola 'empNN' dilewati, jadi aman dijalankan ulang.

BEGIN;

-- ── 1. Peta id lama → id sintetis (hanya yang belum diganti) ──
CREATE TEMP TABLE emp_map ON COMMIT DROP AS
SELECT id AS old_id,
       'emp' || lpad((row_number() OVER (ORDER BY id))::text, 2, '0') AS new_id
FROM employee
WHERE id !~ '^emp[0-9]+$';

-- ── 2. Salinan baris dengan id baru + kolom sudah dianonimkan ──
INSERT INTO employee (id, nama, dept, role, atasan_raw, hod_key, lokasi, masa,
                      panggilan, cabang, whatsapp, am_id, roster_pending, okr_objective, quote)
SELECT m.new_id,
       'Karyawan Demo ' || upper(m.new_id),
       e.dept, e.role,
       CASE WHEN e.atasan_raw IS NULL THEN NULL ELSE 'Atasan Demo' END,
       e.hod_key,
       CASE WHEN e.lokasi IS NULL THEN NULL ELSE 'Lokasi Demo' END,
       CASE WHEN e.masa   IS NULL THEN NULL ELSE 'Sejak 20XX' END,
       'Demo' || upper(right(m.new_id, 2)),
       e.cabang,
       CASE WHEN e.whatsapp IS NULL THEN NULL
            ELSE '62800000' || lpad((abs(hashtext(m.new_id)) % 9000 + 1000)::text, 4, '0') END,
       e.am_id, e.roster_pending,
       CASE WHEN e.okr_objective IS NULL THEN NULL ELSE 'Objective contoh untuk demo.' END,
       CASE WHEN e.quote IS NULL THEN NULL ELSE 'Kutipan contoh untuk demo.' END
FROM employee e JOIN emp_map m ON m.old_id = e.id
ON CONFLICT (id) DO NOTHING;

-- ── 3. Arahkan semua tabel anak ke id baru ──
UPDATE bsc_objective   t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE doc_klaim       t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE employee_task   t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE employee_tool   t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE kpi             t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE lpse_tender     t SET pic_employee_id = m.new_id FROM emp_map m WHERE t.pic_employee_id = m.old_id;
UPDATE okr_key_result  t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE pdca_cycle      t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE raci_assignment t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;
UPDATE voice_item      t SET employee_id     = m.new_id FROM emp_map m WHERE t.employee_id     = m.old_id;

-- ── 4. Buang baris ber-id lama (sudah tak dirujuk siapa pun) ──
DELETE FROM employee WHERE id IN (SELECT old_id FROM emp_map);

-- ── 5. Isi voice_item = keluhan/masukan verbatim per karyawan → paling sensitif ──
UPDATE voice_item SET content = 'Catatan contoh (' || kind || ') untuk demo.'
WHERE content NOT LIKE 'Catatan contoh%';

-- ── 6. Jaring untuk baris yang sudah ber-id emp** tapi kolomnya belum tersapu
--       (mis. skrip versi lama pernah jalan) ──
UPDATE employee SET
  nama      = 'Karyawan Demo ' || upper(id),
  panggilan = 'Demo' || upper(right(id, 2)),
  whatsapp  = CASE WHEN whatsapp IS NULL THEN NULL
                   ELSE '62800000' || lpad((abs(hashtext(id)) % 9000 + 1000)::text, 4, '0') END,
  quote         = CASE WHEN quote IS NULL THEN NULL ELSE 'Kutipan contoh untuk demo.' END,
  okr_objective = CASE WHEN okr_objective IS NULL THEN NULL ELSE 'Objective contoh untuk demo.' END,
  atasan_raw    = CASE WHEN atasan_raw IS NULL THEN NULL ELSE 'Atasan Demo' END,
  lokasi        = CASE WHEN lokasi IS NULL THEN NULL ELSE 'Lokasi Demo' END,
  masa          = CASE WHEN masa IS NULL THEN NULL ELSE 'Sejak 20XX' END
WHERE id ~ '^emp[0-9]+$' AND nama <> 'Karyawan Demo ' || upper(id);

COMMIT;

\echo 'Anonimisasi spine karyawan selesai (id employee → empNN, nama/WA/kutipan/voice_item disintetiskan).'
