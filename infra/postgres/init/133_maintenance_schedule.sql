-- 069 — Preventive Maintenance & Kalibrasi Schedule (F24, AFTERSALES).
-- 1 baris per alat (FK ke installation_unit dari F22) — RECURRING: setelah
-- ditandai selesai, reference_date/due_date baris ini di-ADVANCE ke siklus
-- berikutnya (bukan bikin baris baru). due_date = reference_date + interval_bulan.
--
-- teknisi_wa_number SENGAJA teks bebas (bukan lookup master_user/app_user/
-- monitor_member — semua HR-forbidden per ONBOARDING.md), sama seperti
-- teknisi_name di installation_unit (068).
--
-- status: 'scheduled' (menunggu due) | 'notified' (reminder H-14 sudah
-- terkirim, menunggu teknisi eksekusi & tandai selesai). Idempotensi cron
-- reminder pakai flag ini, bukan exact-date match spt reminder.ts (krn cron
-- jalan harian & harus tetap retry-safe kalau kirim WA gagal hari itu).

CREATE TABLE IF NOT EXISTS maintenance_schedule (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installation_unit_id uuid NOT NULL UNIQUE REFERENCES installation_unit(id) ON DELETE CASCADE,

  interval_bulan       int NOT NULL CHECK (interval_bulan > 0),
  reference_date       date NOT NULL,
  due_date             date NOT NULL,

  teknisi_name         text,
  teknisi_wa_number    text,

  status               text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','notified')),
  notified_at          timestamptz,
  last_completed_at    timestamptz,
  last_note            text,
  completed_count      int NOT NULL DEFAULT 0,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_schedule_due_idx ON maintenance_schedule (due_date);

COMMENT ON TABLE maintenance_schedule IS
  'F24 — PM & Kalibrasi Schedule (AFTERSALES): 1 baris recurring per alat (installation_unit), reminder H-14 ke teknisi, self-contained (teknisi_wa_number teks bebas, tanpa FK domain lain).';
