-- F154 Jadwal Teknisi — jatuh tempo PM PER ALAT (keputusan user 18 Nov 2026).
--
-- Dulu: jatuh tempo per faskes (frekuensi per faskes, kunjungan rutin terakhir ke faskes itu), satu tanggal
-- untuk semua alat. Sekarang tiap alat KSO punya interval sendiri dan dihitung dari PM TERAKHIR alat itu
-- (Riwayat Alat F176: #REPORT, Google Form lama, jadwal rutin). Alat di satu faskes yang jatuh tempo di bulan
-- yang sama tetap digabung satu kunjungan (jadwal_rutin satu baris per faskes, kolom `alat` = alat jatuh tempo).
--
-- Interval yang dipakai (pertama yang terisi):
--   jadwal_pm_alat (per alat) → jadwal_rutin_frekuensi (per faskes, isian lama tetap dihormati)
--   → jadwal_pm_interval (per tipe alat, kso_asset.type_alat) → default skema (PER_TEST 2 bln, lainnya 3 bln).

CREATE TABLE IF NOT EXISTS jadwal_pm_interval (
  type_alat      text        PRIMARY KEY,          -- kunci = upper(btrim(kso_asset.type_alat))
  interval_bulan smallint    NOT NULL CHECK (interval_bulan BETWEEN 1 AND 12),
  oleh           text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE jadwal_pm_interval IS 'F154: interval PM per tipe alat KSO (kunci upper(btrim(type_alat))).';

CREATE TABLE IF NOT EXISTS jadwal_pm_alat (
  kso_asset_id   bigint      PRIMARY KEY REFERENCES kso_asset(id) ON DELETE CASCADE,
  interval_bulan smallint    NOT NULL CHECK (interval_bulan BETWEEN 1 AND 12),
  catatan        text,
  oleh           text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE jadwal_pm_alat IS 'F154: interval PM khusus satu alat KSO — menimpa interval faskes & tipe.';
