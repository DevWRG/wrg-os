-- 075: opsi alasan Closing-Lost baru — Spesifikasi / Harga / Populasi / Komitmen.
-- 'harga' sudah ada di enum. Tambah 3 nilai baru. Nilai lama
-- (kompetitor, no-budget, kalah-tender, internal-RS) DIBIARKAN di enum —
-- Postgres tak bisa DROP enum value & data lama tetap valid; cukup dibuang dari
-- pilihan di UI (LOSS_REASONS). Additive + idempoten (IF NOT EXISTS). PG16.
ALTER TYPE deal_loss_reason ADD VALUE IF NOT EXISTS 'spesifikasi';
ALTER TYPE deal_loss_reason ADD VALUE IF NOT EXISTS 'populasi';
ALTER TYPE deal_loss_reason ADD VALUE IF NOT EXISTS 'komitmen';
