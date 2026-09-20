-- 183 — rantai persetujuan insentif bisa dijalankan (F67, lanjutan 093).
--
-- Migrasi 093 sudah menyiapkan `insentif_bulanan.status` (8 nilai) dan tabel
-- `insentif_approval_log`, tapi tidak ada satu pun jalan memindahkan statusnya: setiap
-- rekap berhenti selamanya di 'draft'. Di sini ditambahkan dua hal yang kurang —
-- SIKLUS dan PEMETAAN LANGKAH → GRUP AKSES.
--
-- ── Kenapa siklus ──
-- 093 menegakkan pemisahan kewenangan lewat UNIQUE (bulanan_id, actor_user_id): satu
-- akun hanya boleh menyentuh satu baris sekali. Aturannya benar untuk SATU putaran
-- review, tapi begitu sebuah rekap DITOLAK dan diajukan ulang, seluruh rantai harus
-- diulang oleh orang-orang yang sama — dan constraint itu membuat putaran kedua mustahil
-- tanpa menghapus jejak putaran pertama. Menghapus jejak bukan pilihan (ini jejak
-- persetujuan pembayaran). Jadi kuncinya diperluas dengan nomor siklus: di dalam satu
-- putaran tetap satu akun satu langkah; putaran baru = lembar baru.
ALTER TABLE insentif_bulanan
  ADD COLUMN IF NOT EXISTS siklus SMALLINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN insentif_bulanan.siklus IS
  'Putaran review ke-berapa. Naik 1 setiap rekap yang ditolak dibuka kembali ke draft.';

ALTER TABLE insentif_approval_log
  ADD COLUMN IF NOT EXISTS siklus SMALLINT NOT NULL DEFAULT 1;

-- Constraint lama dibuat inline di 093 → nama otomatis Postgres. Dibuang, diganti
-- kunci yang memuat siklus. IF EXISTS supaya migrasi tetap idempoten di basis data
-- yang 093-nya sudah/belum di-apply dengan bentuk berbeda.
ALTER TABLE insentif_approval_log
  DROP CONSTRAINT IF EXISTS insentif_approval_log_bulanan_id_actor_user_id_key;

-- Partial: baris pembukaan kembali (status_to = 'draft') TIDAK memakai jatah "satu akun
-- satu langkah". Membuka berkas yang ditolak bukan menyetujui apa pun — kalau ia ikut
-- terhitung, HoD yang menolak lalu membuka kembali akan mengunci dirinya sendiri dari
-- langkah review di putaran berikutnya, dan di cabang yang HoD-nya cuma satu orang itu
-- berarti rekapnya mandek permanen.
CREATE UNIQUE INDEX IF NOT EXISTS insentif_approval_log_siklus_uq
  ON insentif_approval_log (bulanan_id, siklus, actor_user_id)
  WHERE status_to <> 'draft';

-- ── Pemetaan langkah → grup akses ──
--
-- SENGAJA tabel, bukan konstanta di kode. Nama jabatan di WRG berpindah lebih sering
-- daripada rilis aplikasi (Corsec dipegang siapa, Finance mana yang memverifikasi),
-- dan yang berubah kalau salah petakan adalah siapa yang boleh mencairkan uang. Dengan
-- tabel, perubahannya UPDATE satu baris + tercatat, bukan deploy.
--
-- group_key mengacu ke access_group.key (matriks Akses Grup). NULL = langkah itu milik
-- AM yang bersangkutan sendiri (hanya langkah pengajuan). Grup superuser
-- (administrator) selalu boleh — anti-lockout, selaras requireAdmin di seluruh aplikasi —
-- tapi TETAP terikat aturan satu akun satu langkah per siklus.
--
-- Model console_v2 menggambar 7 langkah; langkah ke-2 di sana "System auto-forward",
-- jadi perpindahan yang butuh manusia ada 6. Tujuh status di 093 tetap dipakai apa adanya.
CREATE TABLE IF NOT EXISTS insentif_approval_step (
  step        SMALLINT PRIMARY KEY,
  status_dari VARCHAR(20) NOT NULL,
  status_ke   VARCHAR(20) NOT NULL,
  label       TEXT        NOT NULL,
  group_key   TEXT,
  keterangan  TEXT,
  UNIQUE (status_dari)
);

COMMENT ON TABLE insentif_approval_step IS
  'Urutan rantai persetujuan insentif + grup yang berwenang tiap langkah. Sumber kebenaran untuk repo/insentif-approval.ts; mengubah wewenang = UPDATE group_key di sini, jangan hardcode di kode.';

INSERT INTO insentif_approval_step (step, status_dari, status_ke, label, group_key, keterangan) VALUES
  (1, 'draft',            'submitted',        'Ajukan',             NULL,           'AM yang bersangkutan mengajukan rekapnya sendiri'),
  (2, 'submitted',        'hod_review',       'Review HOD Sales',   'sales-hod',    'Cek flag KSO, tipe lead, kewajaran MR'),
  (3, 'hod_review',       'finance_verify',   'Verifikasi Finance', 'finance-hod',  'Cocokkan aging & faktur dengan Accurate'),
  (4, 'finance_verify',   'corsec_compile',   'Kompilasi Corsec',   'komite',       'Kumpulkan batch yang sudah lolos Finance'),
  (5, 'corsec_compile',   'direktur_approve', 'Persetujuan Direktur','direktur',    'Pola tak wajar + distribusi HO Pool'),
  (6, 'direktur_approve', 'paid',             'Bayar (HRD)',        'hrd',          'Eksekusi transfer payroll')
ON CONFLICT (step) DO NOTHING;
