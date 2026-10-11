-- 201 — F47 Kontrak KSO & Renewal (fase 1).
--
-- KSO diperlakukan sebagai langganan: satu baris = satu MoU untuk satu akun
-- (faskes). Sebelumnya nomor & masa berlaku MoU hanya ada sebagai kolom per
-- ALAT di kso_asset — diulang di tiap alat, dan DITIMPA setiap impor sheet
-- Populasi Alat (scripts/ops/kso-asset-import.mjs: ON CONFLICT DO UPDATE).
--
-- Keputusan user 12 Okt 2026: WRG-OS jadi SUMBER KEBENARAN kontrak. Tabel ini
-- terpisah dari kso_asset dan hanya DIISI AWAL dari sana (INSERT … ON CONFLICT
-- DO NOTHING), sehingga impor sheet berikutnya tidak pernah menimpa perbaikan
-- yang dibuat tim KSO di WRG-OS.
--
-- Data asal berantakan (prod 12 Okt): 65% alat operasional tanpa tanggal MoU,
-- nomor placeholder ('-', 'BELUM MOU', 'DRAFT/…'), 17 MoU tercatat di >1 akun,
-- 6 MoU dengan tanggal berakhir berbeda antar-alat, 79 alat "sudah lewat"
-- (sebagian besar kemungkinan MoU yang diperpanjang tapi sheet-nya tak
-- di-update). Karena itu kontrak hasil isian awal ditandai terverifikasi=false
-- dan TIDAK langsung dianggap habis — tim KSO memverifikasinya di menu.
--
-- Status (alur kerja, disimpan):
--   AKTIF    — berjalan (termasuk yang mendekati/lewat jatuh tempo; "jatuh
--              tempo" itu turunan dari tanggal berakhir, bukan status)
--   NEGO     — sedang negosiasi perpanjangan
--   RENEWED  — sudah diperpanjang; periode baru = baris kontrak BARU
--              (diganti_oleh), sehingga riwayat periode lama tetap ada
--   LOST     — tidak diperpanjang

CREATE TABLE IF NOT EXISTS kso_kontrak (
  id              bigserial PRIMARY KEY,
  nomor           text NOT NULL,
  -- Kunci dedup: huruf besar + spasi dirapatkan ('004 / MRM / I / 2021' ==
  -- '004 / mrm /  I / 2021'). Unik per akun, bukan global: satu MoU payung
  -- bisa mencakup beberapa faskes.
  nomor_norm      text GENERATED ALWAYS AS (upper(regexp_replace(btrim(nomor), '\s+', ' ', 'g'))) STORED,
  account_id      bigint NOT NULL REFERENCES accurate_customer(id),
  mulai           date,
  berakhir        date,
  nkt             numeric(18,2),           -- nilai kontrak tahunan (Rp)
  auto_renew      boolean NOT NULL DEFAULT false,
  pic_nama        text,
  status          text NOT NULL DEFAULT 'AKTIF' CHECK (status IN ('AKTIF', 'NEGO', 'RENEWED', 'LOST')),
  terverifikasi   boolean NOT NULL DEFAULT false,
  sumber          text NOT NULL DEFAULT 'manual' CHECK (sumber IN ('isian_awal', 'manual')),
  diganti_oleh    bigint REFERENCES kso_kontrak(id),
  catatan         text,
  created_by      text,
  updated_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nomor_norm, account_id),
  CHECK (mulai IS NULL OR berakhir IS NULL OR mulai <= berakhir)
);
CREATE INDEX IF NOT EXISTS kso_kontrak_berakhir_idx ON kso_kontrak (berakhir) WHERE status IN ('AKTIF', 'NEGO');
CREATE INDEX IF NOT EXISTS kso_kontrak_account_idx ON kso_kontrak (account_id);

-- Alat yang dicakup kontrak. Satu alat bisa tercatat di lebih dari satu
-- kontrak (periode lama RENEWED + periode baru).
CREATE TABLE IF NOT EXISTS kso_kontrak_alat (
  kontrak_id      bigint NOT NULL REFERENCES kso_kontrak(id) ON DELETE CASCADE,
  kso_asset_id    bigint NOT NULL REFERENCES kso_asset(id),
  PRIMARY KEY (kontrak_id, kso_asset_id)
);
CREATE INDEX IF NOT EXISTS kso_kontrak_alat_asset_idx ON kso_kontrak_alat (kso_asset_id);

-- Riwayat perubahan status & isi (pola lpse_tender_status_log, migrasi 151).
CREATE TABLE IF NOT EXISTS kso_kontrak_log (
  id              bigserial PRIMARY KEY,
  kontrak_id      bigint NOT NULL REFERENCES kso_kontrak(id) ON DELETE CASCADE,
  aksi            text NOT NULL,           -- BUAT / UBAH / STATUS / PERPANJANG / VERIFIKASI
  dari_status     text,
  ke_status       text,
  perubahan       jsonb,
  catatan         text,
  oleh            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kso_kontrak_log_kontrak_idx ON kso_kontrak_log (kontrak_id, created_at);

-- Nomor yang bukan nomor kontrak sungguhan. Satu definisi, dipakai isian awal
-- di bawah DAN layar kelengkapan data (apps/api/src/repo/kso-kontrak.ts).
CREATE OR REPLACE FUNCTION kso_mou_placeholder(nomor text) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT nomor IS NULL
      OR length(btrim(nomor)) < 4
      OR upper(btrim(nomor)) ~ '^(BELUM|TIDAK|TANPA|DRAFT)'
      OR upper(btrim(nomor)) ~ '^(-+|N/?A|NIHIL|KOSONG)$'
$$;

-- Isian awal dari alat OPERASIONAL (kso_asset_status_v, migrasi 197) ber-akun
-- dengan nomor MoU sungguhan. berakhir = tanggal TERJAUH di antara alatnya
-- (MoU yang tanggalnya tak seragam ditandai di layar kelengkapan, bukan
-- ditebak di sini). Idempoten: baris yang sudah ada — termasuk yang sudah
-- diperbaiki tim KSO — tidak disentuh.
INSERT INTO kso_kontrak (nomor, account_id, berakhir, status, terverifikasi, sumber, created_by)
SELECT min(btrim(a.nomor_mou)), a.account_id, max(a.mou_berlaku_sampai), 'AKTIF', false, 'isian_awal', 'migrasi-201'
FROM kso_asset a
JOIN kso_asset_status_v v ON v.id = a.id
WHERE v.status_kode = 'operasional'
  AND a.account_id IS NOT NULL
  AND NOT kso_mou_placeholder(a.nomor_mou)
GROUP BY upper(regexp_replace(btrim(a.nomor_mou), '\s+', ' ', 'g')), a.account_id
ON CONFLICT (nomor_norm, account_id) DO NOTHING;

INSERT INTO kso_kontrak_alat (kontrak_id, kso_asset_id)
SELECT k.id, a.id
FROM kso_kontrak k
JOIN kso_asset a
  ON a.account_id = k.account_id
 AND upper(regexp_replace(btrim(a.nomor_mou), '\s+', ' ', 'g')) = k.nomor_norm
JOIN kso_asset_status_v v ON v.id = a.id
WHERE k.sumber = 'isian_awal' AND v.status_kode = 'operasional'
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON kso_kontrak, kso_kontrak_alat, kso_kontrak_log TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE kso_kontrak_id_seq, kso_kontrak_log_id_seq TO wrg_app;
    GRANT EXECUTE ON FUNCTION kso_mou_placeholder(text) TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON kso_kontrak, kso_kontrak_alat, kso_kontrak_log TO wrg_readonly;
    GRANT EXECUTE ON FUNCTION kso_mou_placeholder(text) TO wrg_readonly;
  END IF;
END $$;
