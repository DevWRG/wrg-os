-- 164 — F52 IT Ticket: pelapor & PIC tertaut ke akun app_user (susulan F22).
--
-- MASALAH: 087 menyimpan `reported_by`/`assigned_to` sebagai TEXT bebas, jadi
-- "Rocky", "rocky", "Pak Rocky" adalah tiga orang berbeda bagi mesin, dan
-- tiket tak bisa disaring "punya saya".
--
-- CATATAN atas komentar 087: teks bebas di sana adalah keputusan SADAR
-- ("pelapor/PIC belum tentu karyawan terdaftar HR"), bukan kelalaian. Migrasi
-- ini TIDAK membalik keputusan itu — ia menambah jalur ber-FK di SAMPING
-- jalur teks, meniru pola yang sudah dipakai F139 GA Helpdesk
-- (`reporter_user_id` + `reporter_name_override`): kalau orangnya punya akun,
-- pakai id; kalau tidak, nama teks tetap sah. Karena itu kedua kolom baru
-- NULLABLE dan kolom teks lama TIDAK disentuh.
--
-- TIDAK ADA BACKFILL by-name. Nama di kolom teks ditulis manusia dengan ejaan
-- bebas; mencocokkannya ke `app_user.name` berarti menebak, dan tebakan yang
-- disimpan sebagai FK jadi data salah yang terlihat sah. Tiket lama tetap
-- menampilkan nama teksnya (jalur tampilan COALESCE di repo/it-ticket.ts).
--
-- Idempoten. Tanpa BEGIN/COMMIT sendiri — runner yang mengatur transaksi.

ALTER TABLE it_ticket
  ADD COLUMN IF NOT EXISTS reported_by_user_id uuid REFERENCES app_user (id) ON DELETE SET NULL;
ALTER TABLE it_ticket
  ADD COLUMN IF NOT EXISTS assigned_to_user_id uuid REFERENCES app_user (id) ON DELETE SET NULL;

-- Index cuma di PIC: itu yang dipakai untuk "tiket yang harus saya kerjakan".
-- Pelapor jarang jadi predikat penyaring, jadi tak diberi index (jangan bayar
-- tulis untuk baca yang tak pernah terjadi).
CREATE INDEX IF NOT EXISTS it_ticket_assigned_user_idx ON it_ticket (assigned_to_user_id);

COMMENT ON COLUMN it_ticket.reported_by_user_id IS
  'F52 — FK app_user kalau pelapor punya akun. NULL & reported_by terisi = pelapor di luar app_user (sah, lihat 087).';
COMMENT ON COLUMN it_ticket.assigned_to_user_id IS
  'F52 — FK app_user kalau PIC punya akun. NULL & assigned_to terisi = PIC di luar app_user (sah).';
