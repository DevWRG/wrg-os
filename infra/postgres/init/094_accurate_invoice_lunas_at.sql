-- F67 — catat KAPAN invoice teramati lunas.
--
-- MASALAH YANG DIPECAHKAN: Collection Factor (model console_v2, PRD §A.2) memotong
-- insentif berdasarkan umur piutang — 0-10 hari dapat 1,05, di atas 90 hari cuma 0,50.
-- Selisihnya lebih dari dua kali lipat. Tapi insentif hanya dihitung untuk invoice yang
-- SUDAH LUNAS, dan untuk invoice lunas kita tidak menyimpan apa pun soal kapan ia dibayar:
--
--   • accurate_invoice hanya punya `tanggal` (terbit), `paid`, `outstanding`, dan `status`
--     yang diturunkan (outstanding ? OPEN : PAID) — tidak ada tanggal pelunasan.
--   • ar_aging_mv hanya memuat invoice yang MASIH outstanding; begitu lunas, barisnya hilang.
--
-- Tanpa kolom ini, satu-satunya perkiraan yang tersedia adalah "hari sejak terbit sampai
-- hari ini", dan itu menghukum sistematis: invoice yang dibayar 5 hari tapi baru dihitung
-- 3 bulan kemudian akan dapat CF 0,50 dan AM-nya tak akan pernah tahu kenapa.
--
-- CARA ISI (lihat upsertInvoiceDetail di apps/api/src/repo/accurateSync.ts):
-- diisi HANYA saat sync MENGAMATI perpindahan OPEN → PAID. Invoice yang sudah berstatus
-- PAID sejak pertama kali terlihat sengaja dibiarkan NULL = "tidak diketahui", BUKAN
-- distempel tanggal hari ini — kalau distempel, semua invoice lama akan terlihat berumur
-- (hari ini − tanggal terbit) dan langsung kena CF 0,50 secara massal.
--
-- KETELITIAN: ini tanggal TERAMATI, bukan tanggal pembayaran sebenarnya. Sync jalan 6x
-- per hari kerja, jadi meleset <= 1 hari di hari kerja, tapi pelunasan hari Jumat sore
-- baru teramati Senin (meleset 3 hari). Untuk tabel CF yang tingkat pertamanya 0-10 hari,
-- ketelitian segitu memadai. Kalau nanti terbukti `raw` dari Accurate memuat tanggal
-- pembayaran sungguhan, kolom ini bisa di-backfill dan jadi presisi.

ALTER TABLE accurate_invoice
  ADD COLUMN IF NOT EXISTS lunas_at date;

COMMENT ON COLUMN accurate_invoice.lunas_at IS
  'Tanggal sync MENGAMATI invoice berpindah OPEN->PAID. NULL = belum lunas ATAU sudah lunas sejak pertama terlihat (umur pelunasan tak diketahui). Dipakai Collection Factor F67.';

-- Dipakai saat mengumpulkan transaksi per periode; sebagian besar baris NULL, jadi partial.
CREATE INDEX IF NOT EXISTS accurate_invoice_lunas_at_idx
  ON accurate_invoice (lunas_at) WHERE lunas_at IS NOT NULL;
