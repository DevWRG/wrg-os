-- 184 — Effort & Presales per AM per bulan disimpan, bukan dititipkan di badan request.
--
-- Di model console_v2 keduanya global per AM per bulan dan masuk ke pengali sebagai
-- (Effort + Presales)/100 — pada rentang 60-100 + 0-10 artinya mereka bisa MENGGANDAKAN
-- selisih insentif dua AM yang penjualannya sama. Sampai sekarang angka itu hanya bisa
-- dikirim lewat body POST /insentif/compute; siapa pun yang menghitung ulang tanpa
-- menyertakannya membuat semua AM jatuh ke default 60/0 — insentif turun diam-diam,
-- tanpa satu baris pun yang menjelaskan kenapa.
--
-- Karena itu nilainya disimpan per periode, dengan jejak siapa yang menyetel.
--
-- Layer 2 (4 aktivitas CRM: kunjungan, pipeline, customer support, retensi KSO) belum
-- bisa dihitung penuh — baru komponen kunjungan yang punya sumber. Jadi kolom ini
-- SENGAJA input manusia dulu, dan `sumber` merekam asalnya supaya saat feed otomatis
-- siap, baris hasil hitungan bisa dibedakan dari baris hasil ketik.
CREATE TABLE IF NOT EXISTS insentif_effort (
  am_id      VARCHAR(50) NOT NULL REFERENCES master_user (am_id) ON DELETE CASCADE,
  periode    CHAR(7)     NOT NULL,          -- 'YYYY-MM'
  -- Rentang 0-100, bukan 60-100: model memberi arti khusus pada skor di bawah 60
  -- ("insentif di-hold sampai persetujuan HOD"), jadi angkanya harus bisa DICATAT
  -- walau penanganannya belum dibangun. Membatasi kolomnya ke 60 akan memaksa
  -- pengisi membulatkan ke atas dan menghapus faktanya.
  effort     NUMERIC(5,2) NOT NULL CHECK (effort BETWEEN 0 AND 100),
  presales   NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (presales BETWEEN 0 AND 10),
  sumber     VARCHAR(12)  NOT NULL DEFAULT 'manual' CHECK (sumber IN ('manual','hitung')),
  catatan    TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (am_id, periode)
);

COMMENT ON TABLE insentif_effort IS
  'Effort (0-100) & Presales (0-10) per AM per bulan untuk pengali insentif F67. Dibaca computePeriode sebagai default; nilai di body request menang atas baris ini (jalur ops/uji).';

COMMENT ON COLUMN insentif_effort.sumber IS
  'manual = diketik HoD/Finance. hitung = diisi feed otomatis saat Layer 2 CRM siap.';
