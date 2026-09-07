-- 168 — Spine grain POSISI & DIVISI dari 6 form PIC Divisi (Drive folder
-- "WRG-OS-PIC", diisi Jul–Agu 2026 oleh PIC tiap divisi atas arahan Direktur).
--
-- KENAPA TABEL BARU, BUKAN PAKAI SPINE KARYAWAN YANG ADA (migrasi 052/053):
-- skema 052 seluruhnya ber-grain KARYAWAN (employee_id, 53 orang, diturunkan
-- dari transkrip wawancara). Data form ini ber-grain POSISI (25) dan DIVISI (6).
-- Memaksakannya ke employee_id berarti mengarang pemetaan posisi→orang yang
-- tidak ada di sumbernya. Selain itu Tabel B (SOP + level otomasi) dan Tabel C
-- (koordinasi antar posisi) tidak punya padanan tabel apa pun di 052.
-- Spine karyawan lama SENGAJA TIDAK DISENTUH — /people/raci, /people/voice,
-- dan /raport tetap membaca sumbernya sendiri. Rekonsiliasi kedua grain
-- (posisi→employee, divisi→department) dikerjakan terpisah supaya hasil
-- pencocokannya bisa ditinjau, bukan fuzzy-match diam-diam di dalam migrasi.
--
-- DIVISI ≠ DEPARTMENT. `department` (9 key, migrasi 052) adalah unit yang
-- dipakai bsc_weight & employee.dept. 6 divisi di form PIC tidak 1:1 dengannya:
--   • "Finance & Supply Chain" membentang 3 key (finance + supplychain + fakturis)
--   • "Sales Area West & East" membentang 3 key (sales + kirimtagih + penawaran)
--   • "Business IVD & Medical" TIDAK punya key department sama sekali
-- Karena itu pemetaannya tabel jembatan N:M (divisi_department), dan `department`
-- tidak diubah. Divisi tanpa pemetaan adalah kondisi SAH, bukan data rusak —
-- v_form_kelengkapan menampilkannya supaya tidak hilang diam-diam.
--
-- TIDAK ADA DATA DI MIGRASI INI selain key/label divisi dan alias jabatan.
-- Repo ini PUBLIK. Migrasi 053 sudah pernah memasukkan PII karyawan sungguhan
-- (53 nama, 50 nomor WhatsApp, kutipan pribadi) ke riwayat git publik dan harus
-- ditambal scripts/db/anonymize-employee-spine.sql. Pola itu TIDAK diulang di
-- sini: nama PIC/HOD, uraian tugas, KPI, dan seluruh isi form masuk lewat
-- scripts/ops/pic-form-to-json.py → pic-form-import.mjs, dengan JSON perantara
-- yang wajib ditulis di luar working tree. Yang di-seed di bawah cuma nama
-- UNIT dan nama JABATAN — bukan orang.
--
-- KOLOM *_raw ADA DI MANA-MANA DAN ITU DISENGAJA. Isi form menyimpang dari
-- dropdown-nya sendiri: kolom "Kondisi Sekarang" memuat 'Manual (Excel)',
-- 'Otomasi (CRM)', 'Accurate'; kolom PJ memuat 'HOD'/'HoD'/'spv keuangan' untuk
-- jabatan yang sama; kolom Level memuat 'L1-L2' dan 'Level 1' bercampur.
-- Nilai apa adanya disimpan di *_raw, hasil normalisasi di kolom bersih, dan
-- yang tidak bisa dinormalisasi ditinggal NULL. Menormalkan destruktif di
-- importer akan menyembunyikan bahwa formnya sendiri belum konsisten.
--
-- BARIS KOSONG DIIMPOR APA ADANYA (keputusan user, 2026-09-07). Kelengkapan
-- form sangat tidak rata: Sales Area W&E cuma 1 baris di Tabel B dan C serta
-- 0 dari 31 tugasnya punya KPI; Accounting & Tax punya 230 langkah SOP tapi
-- hanya 8 yang terisi Target Level. NULL di sini berarti "PIC belum mengisi",
-- bukan "tidak ada targetnya" — v_form_kelengkapan memaparkan rasionya per
-- divisi supaya bolong itu terbaca sebagai bolong.

CREATE TABLE IF NOT EXISTS divisi (
  key        text PRIMARY KEY,
  label      text NOT NULL,
  pic_nama   text,
  hod_nama   text,
  seq        int  NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE divisi IS
  'Unit organisasi versi form PIC Divisi (6). BUKAN department (9 key, migrasi 052) — lihat divisi_department.';
COMMENT ON COLUMN divisi.pic_nama IS
  'Diisi importer, bukan seed migrasi: repo publik.';

CREATE TABLE IF NOT EXISTS divisi_department (
  divisi_key text NOT NULL REFERENCES divisi(key)     ON DELETE CASCADE,
  dept       text NOT NULL REFERENCES department(key)  ON DELETE CASCADE,
  PRIMARY KEY (divisi_key, dept)
);

COMMENT ON TABLE divisi_department IS
  'Jembatan N:M divisi↔department. Divisi tanpa baris di sini (mis. Business IVD & Medical) adalah kondisi sah.';

CREATE TABLE IF NOT EXISTS posisi (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  divisi_key   text NOT NULL REFERENCES divisi(key) ON DELETE CASCADE,
  nama         text NOT NULL,
  jumlah_orang int,
  level_raw    text,
  catatan      text,
  seq          int  NOT NULL DEFAULT 0,
  UNIQUE (divisi_key, nama)
);

COMMENT ON COLUMN posisi.level_raw IS
  'Ejaan level bercampur di sumber (L2 / L1-L2 / Level 1 / L2-L3). Tidak dinormalisasi — belum ada daftar level kanonik yang disahkan.';

-- Kanonikalisasi kolom "PJ (A)". Pola sama brand_alias: nambah ejaan baru =
-- INSERT ke tabel ini, JANGAN tambal daftar di kode importer.
CREATE TABLE IF NOT EXISTS pj_alias (
  alias  text PRIMARY KEY,   -- selalu lower-case
  pj_key text NOT NULL
);

CREATE TABLE IF NOT EXISTS posisi_tugas (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posisi_id     bigint NOT NULL REFERENCES posisi(id) ON DELETE CASCADE,
  uraian        text   NOT NULL,
  rules         text,
  frekuensi_raw text,
  frekuensi     text CHECK (frekuensi IS NULL OR frekuensi IN
                  ('harian','mingguan','bulanan','kuartalan','kejadian')),
  pj_raw        text,
  pj_key        text,
  kpi_target    text,
  seq           int    NOT NULL,
  UNIQUE (posisi_id, seq)
);

COMMENT ON TABLE posisi_tugas IS
  'Tabel A form PIC: job desc + rules + frekuensi + PJ(A) + KPI, satu baris = satu tugas satu posisi.';
COMMENT ON COLUMN posisi_tugas.pj_key IS
  'Hasil pj_alias. NULL = ejaan belum terdaftar di pj_alias, bukan berarti tanpa PJ.';
COMMENT ON COLUMN posisi_tugas.kpi_target IS
  'Kolom "Target / Ukuran (KPI)" apa adanya (teks bebas: "100% order input < 1 jam"). Tidak diparse jadi angka — sumbernya kalimat, bukan metrik terstruktur.';

CREATE TABLE IF NOT EXISTS sop (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  divisi_key text NOT NULL REFERENCES divisi(key) ON DELETE CASCADE,
  nama       text NOT NULL,
  seq        int  NOT NULL DEFAULT 0,
  UNIQUE (divisi_key, nama)
);

CREATE TABLE IF NOT EXISTS sop_langkah (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sop_id       bigint NOT NULL REFERENCES sop(id) ON DELETE CASCADE,
  seq          int    NOT NULL,
  langkah      text   NOT NULL,
  kondisi_raw  text,
  kondisi      text CHECK (kondisi IS NULL OR kondisi IN
                 ('Manual','Digitalisasi','Otomasi','AI')),
  target_raw   text,
  target_level text CHECK (target_level IS NULL OR target_level IN
                 ('Manual','Digitalisasi','Otomasi','AI')),
  catatan      text,
  UNIQUE (sop_id, seq)
);

COMMENT ON TABLE sop_langkah IS
  'Tabel B form PIC: 436 langkah dari 167 SOP, dengan level otomasi sekarang vs target.';
COMMENT ON COLUMN sop_langkah.kondisi IS
  'Kondisi SEKARANG. Jangan tertukar dengan target_level: distribusi otomasi yang tampil di WRG-OS_Blueprint-Operasional.html (Manual 22 · Digitalisasi 122 · Otomasi 37 · AI 4) adalah TARGET, sedangkan kondisi sekarang 289 Manual · 115 Digitalisasi.';

CREATE TABLE IF NOT EXISTS posisi_koordinasi (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  posisi_id   bigint NOT NULL REFERENCES posisi(id) ON DELETE CASCADE,
  dengan_raw  text   NOT NULL,
  dengan_key  text,
  dengan_grup text CHECK (dengan_grup IS NULL OR dengan_grup IN ('internal','external')),
  apa         text,
  pemicu      text,
  seq         int    NOT NULL,
  UNIQUE (posisi_id, seq)
);

COMMENT ON TABLE posisi_koordinasi IS
  'Tabel C form PIC: jaringan koordinasi DEKLARATIF (yang seharusnya terjadi). Beda arti dari /network yang jalan dari message_annotation — itu jaringan hasil OBSERVASI chat WA. Sengaja tabel terpisah: menggabungkannya membuat dua-duanya kehilangan makna (yang dirancang vs yang betul-betul terjadi).';
COMMENT ON COLUMN posisi_koordinasi.dengan_key IS
  'Lawan koordinasi dinormalisasi ke divisi_key atau label eksternal (Customer/User, Vendor/Principal, Leadership). NULL = belum terklasifikasi.';

CREATE TABLE IF NOT EXISTS divisi_okr (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  divisi_key      text NOT NULL REFERENCES divisi(key) ON DELETE CASCADE,
  objective       text NOT NULL,
  perspective_raw text,
  perspective     text CHECK (perspective IS NULL OR perspective IN
                    ('fin','cust','proc','learn')),
  seq             int  NOT NULL,
  UNIQUE (divisi_key, seq)
);

COMMENT ON TABLE divisi_okr IS
  'Sheet "OKR Divisi" (diisi HOD). Grain DIVISI — beda dari employee.okr_objective & okr_key_result (grain karyawan, migrasi 052).';
COMMENT ON COLUMN divisi_okr.perspective IS
  'Kode perspektif BSC sama dengan bsc_objective.perspective (fin/cust/proc/learn) supaya bisa diagregasi bareng: Keuangan→fin, Pelanggan→cust, Proses Internal→proc, Pembelajaran & Pertumbuhan→learn.';

CREATE TABLE IF NOT EXISTS divisi_okr_kr (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  okr_id     bigint NOT NULL REFERENCES divisi_okr(id) ON DELETE CASCADE,
  key_result text   NOT NULL,
  seq        int    NOT NULL,
  UNIQUE (okr_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_posisi_divisi          ON posisi (divisi_key);
CREATE INDEX IF NOT EXISTS idx_posisi_tugas_posisi    ON posisi_tugas (posisi_id);
CREATE INDEX IF NOT EXISTS idx_posisi_tugas_pj        ON posisi_tugas (pj_key);
CREATE INDEX IF NOT EXISTS idx_sop_divisi             ON sop (divisi_key);
CREATE INDEX IF NOT EXISTS idx_sop_langkah_sop        ON sop_langkah (sop_id);
CREATE INDEX IF NOT EXISTS idx_koordinasi_posisi      ON posisi_koordinasi (posisi_id);
CREATE INDEX IF NOT EXISTS idx_koordinasi_dengan      ON posisi_koordinasi (dengan_key);
CREATE INDEX IF NOT EXISTS idx_divisi_okr_divisi      ON divisi_okr (divisi_key);

-- ---------------------------------------------------------------------------
-- Seed: key + label unit organisasi. Nama PIC/HOD TIDAK di sini (repo publik).
-- ---------------------------------------------------------------------------
INSERT INTO divisi (key,label,seq) VALUES
  ('aftersales',   'Aftersales',             1),
  ('finance_sc',   'Finance & Supply Chain', 2),
  ('acctax',       'Accounting & Tax',       3),
  ('sales_area',   'Sales Area West & East', 4),
  ('business_ivd', 'Business IVD & Medical', 5),
  ('bd_ga',        'BD & GA',                6)
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, seq = EXCLUDED.seq;

-- Pemetaan ke department. business_ivd sengaja tidak punya baris: tidak ada
-- key department yang mewakilinya, dan mengarang key baru akan mengubah
-- bsc_weight & employee.dept di luar cakupan perubahan ini.
INSERT INTO divisi_department (divisi_key,dept) VALUES
  ('aftersales', 'aftersales'),
  ('finance_sc', 'finance'),
  ('finance_sc', 'supplychain'),
  ('finance_sc', 'fakturis'),
  ('acctax',     'acctax'),
  ('sales_area', 'sales'),
  ('sales_area', 'kirimtagih'),
  ('sales_area', 'penawaran'),
  ('bd_ga',      'ga')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Seed pj_alias: 19 ejaan berbeda di kolom "PJ (A)" untuk jabatan yang sama.
-- Nama JABATAN, bukan nama orang.
-- ---------------------------------------------------------------------------
INSERT INTO pj_alias (alias,pj_key) VALUES
  ('hod',                             'HOD'),
  ('hod finance & supply chain',      'HOD Finance & Supply Chain'),
  ('hod accounting & tax',            'HOD Accounting & Tax'),
  ('hod sales',                       'HOD Sales'),
  ('spv finance',                     'SPV Finance'),
  -- 'spv keuangan' (3 baris, divisi Finance & SC) disatukan ke SPV Finance:
  -- sheet "PIC & HOD" divisi itu hanya mendaftarkan satu SPV Finance
  -- (Invoicing, AR/CN, Treasury), jadi ini terjemahan Indonesia dari jabatan
  -- yang sama. Kalau ternyata jabatan terpisah, hapus baris ini — pj_raw tetap
  -- menyimpan ejaan aslinya sehingga tidak ada data yang hilang.
  ('spv keuangan',                    'SPV Finance'),
  ('spv supply chain',                'SPV Supply Chain'),
  ('pic ivd',                         'PIC IVD'),
  ('pic non-ivd',                     'PIC Non-IVD'),
  ('am',                              'AM'),
  ('admin sales',                     'Admin Sales'),
  -- 'Admin Sales & Penawaran' dan 'Admin Inventory' SENGAJA tidak disatukan
  -- ke 'Admin Sales'/'Staff Inventory'. Ejaannya memang mirip, tapi tidak ada
  -- bukti di form bahwa itu jabatan yang sama, dan menyatukan jabatan yang
  -- berbeda akan salah mengalamatkan Accountable di matriks RACI.
  ('admin sales & penawaran',         'Admin Sales & Penawaran'),
  ('admin inventory',                 'Admin Inventory'),
  ('staff inventory',                 'Staff Inventory'),
  ('staff petty cash & funding',      'Staff Petty Cash & Funding'),
  ('staff distribution',              'Staff Distribution'),
  ('staff purchasing',                'Staff Purchasing'),
  ('staff shipping',                  'Staff Shipping')
ON CONFLICT (alias) DO UPDATE SET pj_key = EXCLUDED.pj_key;

-- ---------------------------------------------------------------------------
-- v_raci_posisi — R & A langsung dari Tabel A, tanpa tabel turunan.
-- R = posisi pelaksana, A = PJ. C/I tidak ada di sini: sumbernya
-- posisi_koordinasi (Tabel C), grain-nya beda (pasangan posisi, bukan tugas).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_raci_posisi AS
SELECT d.key                                   AS divisi_key,
       d.label                                 AS divisi,
       t.uraian                                AS proses,
       p.nama                                  AS r_responsible,
       COALESCE(t.pj_key, t.pj_raw)            AS a_accountable,
       t.pj_key IS NULL AND t.pj_raw IS NOT NULL AS a_belum_kanonik,
       t.frekuensi,
       t.kpi_target,
       t.posisi_id,
       t.id                                    AS tugas_id
FROM posisi_tugas t
JOIN posisi p ON p.id = t.posisi_id
JOIN divisi d ON d.key = p.divisi_key;

-- ---------------------------------------------------------------------------
-- v_form_kelengkapan — seberapa lengkap tiap PIC mengisi formnya.
-- Ada supaya sel yang bolong terbaca sebagai bolong, bukan lenyap di balik
-- agregat. Angka nol di sini adalah temuan, bukan bug.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_form_kelengkapan AS
WITH t AS (
  SELECT p.divisi_key,
         count(*)                                        AS tugas,
         count(tg.kpi_target)                            AS tugas_ada_kpi,
         count(tg.pj_raw)                                AS tugas_ada_pj,
         count(tg.pj_key)                                AS tugas_pj_kanonik
  FROM posisi p JOIN posisi_tugas tg ON tg.posisi_id = p.id
  GROUP BY 1
), s AS (
  SELECT so.divisi_key,
         count(*)                     AS langkah_sop,
         count(DISTINCT so.id)        AS sop,
         count(sl.kondisi)            AS langkah_ada_kondisi,
         count(sl.target_level)       AS langkah_ada_target
  FROM sop so JOIN sop_langkah sl ON sl.sop_id = so.id
  GROUP BY 1
), k AS (
  SELECT p.divisi_key, count(*) AS koordinasi, count(ko.dengan_key) AS koordinasi_terklasifikasi
  FROM posisi p JOIN posisi_koordinasi ko ON ko.posisi_id = p.id
  GROUP BY 1
), o AS (
  SELECT divisi_key, count(*) AS objective, count(perspective) AS objective_ada_perspektif
  FROM divisi_okr GROUP BY 1
), pos AS (
  SELECT divisi_key, count(*) AS posisi FROM posisi GROUP BY 1
)
SELECT d.key AS divisi_key,
       d.label AS divisi,
       d.pic_nama,
       COALESCE(pos.posisi, 0)      AS posisi,
       COALESCE(t.tugas, 0)         AS tugas,
       COALESCE(s.sop, 0)           AS sop,
       COALESCE(s.langkah_sop, 0)   AS langkah_sop,
       COALESCE(k.koordinasi, 0)    AS koordinasi,
       COALESCE(o.objective, 0)     AS objective,
       -- rasio kelengkapan, NULL kalau penyebutnya nol (bukan 0% — beda arti:
       -- "tidak ada barisnya" vs "ada barisnya tapi kosong semua")
       round(100.0 * t.tugas_ada_kpi           / NULLIF(t.tugas, 0), 1) AS pct_tugas_ada_kpi,
       round(100.0 * t.tugas_ada_pj            / NULLIF(t.tugas, 0), 1) AS pct_tugas_ada_pj,
       round(100.0 * t.tugas_pj_kanonik        / NULLIF(t.tugas, 0), 1) AS pct_pj_kanonik,
       round(100.0 * s.langkah_ada_kondisi     / NULLIF(s.langkah_sop, 0), 1) AS pct_langkah_ada_kondisi,
       round(100.0 * s.langkah_ada_target      / NULLIF(s.langkah_sop, 0), 1) AS pct_langkah_ada_target,
       round(100.0 * k.koordinasi_terklasifikasi / NULLIF(k.koordinasi, 0), 1) AS pct_koordinasi_terklasifikasi,
       round(100.0 * o.objective_ada_perspektif  / NULLIF(o.objective, 0), 1) AS pct_objective_ada_perspektif,
       EXISTS (SELECT 1 FROM divisi_department dd WHERE dd.divisi_key = d.key) AS terpetakan_ke_department
FROM divisi d
LEFT JOIN pos ON pos.divisi_key = d.key
LEFT JOIN t   ON t.divisi_key   = d.key
LEFT JOIN s   ON s.divisi_key   = d.key
LEFT JOIN k   ON k.divisi_key   = d.key
LEFT JOIN o   ON o.divisi_key   = d.key
ORDER BY d.seq;

-- Migrasi 157 mengeraskan hak baca (readonly_hardening). GRANT hilang saat
-- DROP VIEW, jadi hak baca view di sini disamakan dengan tabel sekitarnya.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON divisi, divisi_department, posisi, posisi_tugas, sop,
                    sop_langkah, posisi_koordinasi, divisi_okr, divisi_okr_kr,
                    pj_alias, v_raci_posisi, v_form_kelengkapan
      TO wrg_readonly;
  END IF;
END $$;
