-- WRG Monitor (port wrg-monitor): direktori member WhatsApp + roster organisasi.
-- monitor_member = gabungan roster.json (nama/panggilan/posisi/cabang, sumber
-- kebenaran org) + members.json (nama WA + keanggotaan grup), di-key nomor HP.
-- Fase berikut menambahkan rekap/resume/pola.
CREATE TABLE IF NOT EXISTS monitor_member (
  phone        VARCHAR(30) PRIMARY KEY,
  nama         TEXT,
  panggilan    TEXT,
  posisi       TEXT,
  cabang       TEXT,
  wa_name      TEXT,
  group_count  INTEGER NOT NULL DEFAULT 0,
  in_roster    BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS monitor_member_cabang_idx ON monitor_member (cabang);
