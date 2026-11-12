-- 311 — Daily Summary: TUA + pengelompokan per HOD (keputusan product owner 12 Nov 2026).
--
-- Halaman /ds/<token> (308) kini dikelompokkan per HOD (HOD → cabang → orang) dan memuat item TUA — OUTSTANDING
-- berumur > 4 jam dari resume eksekutif grup WA (monitor_digest kind='resume' terbaru hari itu) — juga per HOD.
-- Pemetaan item TUA: PIC/grup → cabang → HOD (hod_territory). Pesan WA hanya menambah satu baris jumlah TUA per HOD.
-- Snapshot disimpan per tanggal supaya halaman lama tetap sama walau peta HOD/resume berubah kemudian.

ALTER TABLE daily_summary_link
  ADD COLUMN IF NOT EXISTS hod        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{hod_key, nama, cabang:[...]}]
  ADD COLUMN IF NOT EXISTS tua        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{topik, dari, ke, umur, status, cabang, hod_key}]
  ADD COLUMN IF NOT EXISTS tua_sumber text;                                -- "resume 14:00" (null = tak ada resume hari itu)
COMMENT ON COLUMN daily_summary_link.hod IS '311: snapshot peta HOD → cabang (master_hod + hod_territory) saat ringkasan dibuat.';
COMMENT ON COLUMN daily_summary_link.tua IS '311: item OUTSTANDING TUA (> 4 jam) dari resume grup WA terbaru hari itu, sudah dipetakan ke cabang/HOD.';
