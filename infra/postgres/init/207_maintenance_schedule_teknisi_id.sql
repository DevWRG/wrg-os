-- 207 — F24 PM & Kalibrasi: teknisi dipilih dari roster (teknisi_capacity, F8).
--
-- MASALAH: maintenance_schedule.teknisi_name teks bebas (133 sengaja
-- self-contained). Readiness Board menghitung beban PM dengan mencocokkan
-- teknisi_name = teknisi_capacity.nama PERSIS — nama yang diketik "Galih"
-- sementara roster "Galih Aldy Prasetyo" tak terhitung sama sekali, jadi
-- kapasitas teknisi terlihat longgar padahal ia pegang PM (uji dev 12 Okt 2026,
-- D6). Sejak #1638 kapasitas itu juga dipakai MENOLAK jadwal instalasi, jadi
-- beban yang hilang = teknisi bisa kelebihan kerja tanpa ada yang tahu.
--
-- Keputusan user 2026-10-13 (opsi a): teknisi PM WAJIB dipilih dari roster.
-- Pola HYBRID FK + snapshot, sama dengan installation_unit.teknisi_id (159):
--   · teknisi_id   → sumber kebenaran untuk hitungan beban & join
--   · teknisi_name / teknisi_wa_number tetap ada → snapshot dari roster saat dipilih
--
-- NULLABLE & TANPA BACKFILL (preseden 159/163): baris lama dibiarkan NULL dan
-- tetap dihitung lewat kecocokan nama persis seperti sebelumnya (lihat
-- getReadinessBoard) — menebak teknisi dari nama ketikan bebas berisiko salah
-- pasang. Kewajiban "pilih dari roster" ditegakkan di aplikasi
-- (createSchedule), bukan oleh constraint DB.
--
-- Idempoten. Tanpa BEGIN/COMMIT sendiri — runner (scripts/db/migrate.sh) yang
-- mengatur transaksi.
ALTER TABLE maintenance_schedule
  ADD COLUMN IF NOT EXISTS teknisi_id uuid REFERENCES teknisi_capacity(id);

-- Index pada FK: dipakai hitungan beban per teknisi (Readiness Board & gerbang
-- kapasitas jadwal instalasi). Postgres tak membuat index otomatis untuk FK.
CREATE INDEX IF NOT EXISTS maintenance_schedule_teknisi_idx
  ON maintenance_schedule (teknisi_id) WHERE teknisi_id IS NOT NULL;

COMMENT ON COLUMN maintenance_schedule.teknisi_id IS
  'FK teknisi_capacity (roster F8). NULL = baris lama (pra-207) atau belum ditugaskan. teknisi_name/teknisi_wa_number = snapshot dari roster saat dipilih.';
