-- 208 — F95 Interaction Log: #CALL / #NOTE per customer (timeline Accounts 360).
--
-- Keputusan user (2026-10-13):
--   • #CALL/#NOTE TIDAK ikut KPI aktivitas AM (kepatuhan plan-report, ringkasan
--     harian, laporan mingguan, target kunjungan). Makanya tabel SENDIRI, bukan
--     activity_log — ±15 query KPI menghitung semua baris activity_log tanpa
--     filter tipe/sumber, jadi menulis ke sana akan menggelembungkan angka diam-
--     diam. Telepon yang memang mau dihitung tetap lewat #REPORT `tipe: telp`.
--   • Tampil di timeline /accounts/[id] bersama activity_log, perubahan tahap
--     deal, dan faktur.
--
-- account_id = accurate_customer.id, soft ref seperti activity_log.account_id
-- (mirror Accurate bisa disinkron ulang; FK keras akan menahan sinkron).
-- wa_message_id UNIQUE = idempoten: pesan WA yang diproses ulang tak dobel.
-- Additive & idempoten.

CREATE TABLE IF NOT EXISTS interaction_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id      bigint NOT NULL,                 -- accurate_customer.id
  jenis           text   NOT NULL CHECK (jenis IN ('call','note')),
  isi             text   NOT NULL CHECK (btrim(isi) <> ''),
  am_id           text,                            -- pencatat (master_user.am_id)
  pencatat_nama   text   NOT NULL,                 -- snapshot nama saat dicatat
  customer_query  text,                            -- nama faskes seperti DIKETIK pengirim
  source          text   NOT NULL DEFAULT 'wa' CHECK (source IN ('wa','web')),
  group_jid       text,
  wa_message_id   text UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interaction_log_account_idx ON interaction_log (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS interaction_log_am_idx      ON interaction_log (am_id, created_at DESC);

-- Inti nama faskes (faskes_inti, migrasi 176) tanpa tanda baca, untuk uji
-- "semua kata yang diketik ada di nama faskes". Nama Accurate terbalik membawa
-- koma ("NU BABAT, RS" → inti 'nu babat,'), dan token 'babat,' ≠ 'babat'.
-- Kenapa jalur ini perlu: trigram menghukum nama panjang — 'rs babat' lawan
-- 'MUHAMMADIYAH BABAT, RSU' cuma 0,32, jadi tanpa jalur ini #CALL rs babat
-- diam-diam menempel ke NU Babat (satu-satunya yang lolos ambang) padahal
-- pengirimnya memang tak menyebut yang mana. Ditaruh di SQL, bukan di template
-- literal TypeScript, karena `\s` di sana luruh jadi `s` tanpa error.
CREATE OR REPLACE FUNCTION faskes_inti_kata(s text) RETURNS text AS $f$
  SELECT btrim(regexp_replace(faskes_inti(s), '[^a-z0-9]+', ' ', 'g'))
$f$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON interaction_log TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON interaction_log TO wrg_readonly;
  END IF;
END $$;
