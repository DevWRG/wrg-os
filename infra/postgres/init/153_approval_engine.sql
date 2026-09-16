-- 106 — F11 Approval Engine #APPROVE/#REJECT bot. BASE/generic engine
-- (arahan Direktur meeting 2026-08-13) — fitur lain ke depan reuse tabel
-- ini, bukan bikin approval sendiri-sendiri.
--
-- Alur: HoD Sales → HoD Bisnis → HoD After Sales → HoD Supply Chain →
-- Direktur, SEKUENSIAL (bukan broadcast ke semua sekaligus) — approve di
-- 1 tahap baru trigger notifikasi tahap berikutnya via WA PRIVAT (bukan
-- grup). Reject di tahap manapun langsung hentikan chain.
--
-- KONTAK BELUM ADA saat migrasi ini ditulis — user (magang) belum tahu WA
-- HoD Sales/Bisnis/Supply Chain, Direktur akan kasih menyusul (lihat
-- memory.md). `approval_chain_config` didesain supaya kontak bisa diisi
-- belakangan TANPA ubah kode/redeploy, via halaman /approval-requests/config.
-- Slot "HoD After Sales" default `hod_key='muhid'` — satu2nya dari 8 HoD
-- (apps/api/src/hod-resolver.ts) yang gak ambigu terhadap label generik di
-- brief Direktur. Resolusi kontak SELALU lewat `app_user.hod_key`/
-- `app_user.role='direktur'` → `wa_number` saat KIRIM (bukan disnapshot),
-- supaya begitu app_user diisi nanti otomatis kepakai tanpa migrasi baru.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS approval_chain_config (
  urutan              int PRIMARY KEY,
  label               text NOT NULL,
  -- 'hod' → resolve via app_user.hod_key; 'direktur' → resolve via
  -- app_user.role='direktur'. Dibatasi 2 cara (bukan kolom bebas) supaya
  -- resolusi target tetap konsisten & bisa diaudit.
  target_type         text NOT NULL CHECK (target_type IN ('hod', 'direktur')),
  hod_key             text,   -- NULL = belum dikonfigurasi (state sah, bukan error)
  wa_number_override  text,   -- fallback kalau orangnya belum py akun app_user (mis. Pita, bukan HoD)
  catatan             text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

INSERT INTO approval_chain_config (urutan, label, target_type, hod_key, catatan) VALUES
  (1, 'HoD Sales', 'hod', NULL,
     'Kontak BELUM dikonfigurasi (2026-08-13) — kandidat: Rocky (Sales East) atau Yogi (Sales West), belum diputuskan. Isi hod_key via halaman config setelah Direktur kasih kontak.'),
  (2, 'HoD Bisnis', 'hod', NULL,
     'Kontak BELUM dikonfigurasi — kandidat: Mufid (Business IVD) atau Arman (Business Medical), belum diputuskan.'),
  (3, 'HoD After Sales', 'hod', 'muhid',
     'Satu2nya slot non-ambigu di roster 8 HoD (hod-resolver.ts) — resolve via app_user.hod_key=muhid.'),
  (4, 'HoD Supply Chain', 'hod', NULL,
     'Kontak BELUM dikonfigurasi — kandidat: Ika (HoD Finance & SC resmi) atau Pita (Leader Supply Chain, tugas hariannya approval SC tapi bukan level HoD), belum diputuskan.'),
  (5, 'Direktur', 'direktur', NULL,
     'Resolve via app_user.role=''direktur''. Kalau ada >1 baris role=direktur, ambil yang wa_number terisi pertama (belum ada kasus ganda, jangan over-engineer sebelum kejadian).')
ON CONFLICT (urutan) DO NOTHING;

-- Nomor urut kode referensi (dipakai balasan #APPROVE/#REJECT <kode>) —
-- SEQUENCE (bukan count(*)+1) supaya atomik, tak race meski dua request
-- dibuat bersamaan.
CREATE SEQUENCE IF NOT EXISTS approval_request_kode_seq START 1;

CREATE TABLE IF NOT EXISTS approval_request (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kode            text NOT NULL UNIQUE,
  title           text NOT NULL,
  description     text,
  -- Opsional, dari blueprint asli "multi-tier NOMINAL-BASED" — TIDAK dipakai
  -- menentukan jumlah tahap sekarang (chain SELALU fix 5 tahap per arahan
  -- Direktur di meeting 2026-08-13, override blueprint lama). Disimpan buat
  -- histori/tampilan & kalau nanti Direktur balik minta tier-by-nominal.
  nominal         numeric(16, 2),
  requested_by    text NOT NULL,
  requested_by_wa text,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  current_urutan  int,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);

CREATE TABLE IF NOT EXISTS approval_step (
  id              bigserial PRIMARY KEY,
  request_id      uuid NOT NULL REFERENCES approval_request (id) ON DELETE CASCADE,
  urutan          int NOT NULL,
  label           text NOT NULL,     -- snapshot approval_chain_config.label SAAT request dibuat
  target_type     text NOT NULL,
  hod_key         text,              -- snapshot REFERENSI (bukan nomor WA — nomor diresolve live saat kirim)
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  notified_at     timestamptz,
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  UNIQUE (request_id, urutan)
);

CREATE INDEX IF NOT EXISTS approval_step_request_idx ON approval_step (request_id);

-- Lampiran PDF/PNG (arahan user 2026-08-18, susulan setelah base engine
-- selesai). Disk lokal (bukan bytea di DB) — pola sama filosofi MEDIA_ROOT
-- WA (index.ts), tapi direktori TERPISAH (`APPROVAL_UPLOAD_ROOT`) krn ini
-- upload dari BROWSER (dashboard), bukan hasil download WA bridge. Mime
-- dibatasi persis 2 jenis yang diminta — jangan longgarkan tanpa diminta.
CREATE TABLE IF NOT EXISTS approval_attachment (
  id           bigserial PRIMARY KEY,
  request_id   uuid NOT NULL REFERENCES approval_request (id) ON DELETE CASCADE,
  filename     text NOT NULL,
  mime_type    text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png')),
  file_path    text NOT NULL,   -- relatif thd APPROVAL_UPLOAD_ROOT
  file_size    int NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS approval_attachment_request_idx ON approval_attachment (request_id);

COMMENT ON TABLE approval_attachment IS
  'F11 — lampiran PDF/PNG per approval_request, disimpan di disk (APPROVAL_UPLOAD_ROOT), link-nya disisipkan di pesan WA notifikasi.';

COMMENT ON TABLE approval_chain_config IS
  'F11 — urutan tahap approval GLOBAL (base engine, 1 chain utk semua request sekarang). hod_key NULL = kontak belum dikonfigurasi, bukan error.';
COMMENT ON TABLE approval_request IS
  'F11 — 1 baris per permintaan approval. status berubah lewat balasan WA #APPROVE/#REJECT dari approver tahap current_urutan.';
COMMENT ON TABLE approval_step IS
  'F11 — snapshot per-tahap 1 approval_request (dari approval_chain_config saat request dibuat), jejak notifikasi & keputusan tiap tahap.';
