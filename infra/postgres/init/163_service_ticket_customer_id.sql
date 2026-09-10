-- 163 — F26 Service Ticket: tautkan ke customer sungguhan (susulan F22).
--
-- MASALAH: 135 hanya punya `customer_name text` yang diisi bebas dari form —
-- tak bisa di-join ke apa pun, dan ejaan bisa menyimpang dari master.
--
-- Pola ikut migrasi 159 (F22) & 162: HYBRID — FK baru NULLABLE, kolom teks
-- `customer_name` DIPERTAHANKAN sebagai snapshot historis. Nullable itu
-- SYARAT, bukan kompromi: tiket bisa masuk dari WA (source='wa') tanpa
-- kecocokan customer mana pun, dan itu perilaku yang diinginkan — komplain
-- tetap harus bisa tercatat walau penelepon tak dikenali.
--
-- TIDAK ADA BACKFILL, dan itu keputusan sadar. Satu-satunya jembatan yang
-- tersedia adalah nama, dan pencocokan nama di sini tidak aman: pengukuran
-- 2026-09-03 atas `accurate_customer` prod menemukan nama KANONIK penuh
-- memang unik (0 kembar), tapi nama pendek seperti yang diketik orang di form
-- ini menabrak banyak customer sekaligus — 174 nama pendek bertabrakan, mis.
-- "IKA" → 8 customer, "PERTAMEDIKA IHC" → 7, "BHAYANGKARA" → 6. Menebak di
-- antara 8 faskes lalu menyimpannya sebagai FK = data salah yang terlihat
-- sah. Tiket lama tetap NULL; yang baru tertaut sejak form dipakai.
--
-- Idempoten. Tanpa BEGIN/COMMIT sendiri — runner (scripts/db/migrate.sh) yang
-- mengatur transaksi.

ALTER TABLE service_ticket
  ADD COLUMN IF NOT EXISTS customer_id bigint REFERENCES accurate_customer (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS service_ticket_customer_idx ON service_ticket (customer_id);

COMMENT ON COLUMN service_ticket.customer_id IS
  'F26 — FK ke accurate_customer (mirror). NULL = belum/tak tertaut (tiket WA tanpa kecocokan, atau tiket sebelum migrasi 163). customer_name tetap snapshot nama.';
