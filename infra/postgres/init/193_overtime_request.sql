-- 193 — #OVERTIME: pengajuan jam lembur via WA (SEBELUM lembur), disetujui
-- HoD divisi pengaju (SATU tahap), dicatat untuk HR.
--
-- Keputusan Direktur/PM (2026-09-30):
--   • pengajuan diisi: estimasi durasi + uraian pekerjaan;
--   • yang berhak mengajukan hanya posisi/divisi tertentu → tabel aturan
--     DINAMIS (overtime_rule), diedit admin dari dashboard, bukan hardcode;
--   • approver = HoD divisi terkait langsung (BUKAN chain global F11 5 tahap —
--     engine itu kaku & masih tersangkut #1071, jadi tabel/status sendiri,
--     pola leave_pending);
--   • HoD tak ketemu → pengajuan TETAP dicatat, menunggu admin menetapkan
--     approver (bukan ditolak).
-- Uji coba dulu hanya di grup Research; target grup produksi ditentukan
-- Direktur (rides on WA_INBOUND_GROUPS, tak ada env-gate baru).
-- Additive & idempoten.

-- Aturan siapa boleh mengajukan. Satu baris = satu aturan; sebuah pengaju lolos
-- kalau ADA aturan aktif yang cocok:
--   • am_id terisi           → pengecualian per orang (cocok kalau am_id sama);
--   • am_id kosong           → cocok kalau dept sama (atau dept kosong = semua)
--                              DAN posisi cocok pola ILIKE (atau pola kosong).
-- Sedikitnya satu dari dept / posisi_pattern / am_id wajib terisi supaya tak ada
-- aturan "semua orang" yang tak sengaja.
CREATE TABLE IF NOT EXISTS overtime_rule (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dept            text,            -- employee.dept (department.key), mis. 'finance'
  posisi_pattern  text,            -- dicocokkan ILIKE '%pola%' ke master_user.posisi / employee.role
  am_id           text,            -- pengecualian per orang (master_user.am_id)
  catatan         text,
  aktif           boolean NOT NULL DEFAULT true,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT overtime_rule_nonempty CHECK (dept IS NOT NULL OR posisi_pattern IS NOT NULL OR am_id IS NOT NULL)
);

CREATE SEQUENCE IF NOT EXISTS overtime_request_kode_seq START 1;

CREATE TABLE IF NOT EXISTS overtime_request (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kode            text NOT NULL UNIQUE,            -- OT-0001 (dibalas #APPROVE/#REJECT OT-0001)
  am_id           text NOT NULL,                   -- pengaju (master_user.am_id)
  nama            text NOT NULL,
  dept            text,                            -- snapshot employee.dept saat diajukan
  tanggal_lembur  date NOT NULL,                   -- default: hari pesan (WIB)
  estimasi_menit  int  NOT NULL CHECK (estimasi_menit > 0 AND estimasi_menit <= 1440),
  uraian          text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  hod_key         text,                            -- HoD yg berwenang; NULL = belum ketemu (tunggu admin)
  approver_nama   text,                            -- snapshot nama HoD saat notifikasi terkirim
  notify_status   text,                            -- 'terkirim' | 'gagal: <sebab>' | NULL (belum dicoba)
  group_jid       text,                            -- grup asal pengajuan (tujuan balasan hasil)
  wa_message_id   text,
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS overtime_request_status_idx ON overtime_request (status, created_at DESC);
CREATE INDEX IF NOT EXISTS overtime_request_am_idx     ON overtime_request (am_id, tanggal_lembur);
-- Idempotensi WA: satu pesan tak boleh membuat dua pengajuan (retry webhook).
CREATE UNIQUE INDEX IF NOT EXISTS overtime_request_wa_msg_uq
  ON overtime_request (wa_message_id) WHERE wa_message_id IS NOT NULL;
