-- 180 — F-CASHIN: penanganan SELISIH antara angka sistem dan hitungan Finance.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.
--
-- Dipicu kejadian nyata 18 Sep 2026: draft melaporkan MDR 038 Rp 138.252.787,
-- Finance menghitung Rp 88.252.787. Finance yang benar — ada pasangan puteran
-- 50 juta yang gagal dikenali. Tiga kekurangan yang ketahuan dari situ:
--
--  1. JALAN BUNTU. Kalau Finance membalas "tidak R3", status 'ditolak' bersifat
--     FINAL: putuskanResume menolak keputusan ulang, dan buatDraftJikaLengkap
--     menolak menyusun draft baru karena statusnya bukan 'menunggu_konfirmasi'.
--     Jadi begitu ditolak, tanggal itu TAK PERNAH bisa sampai ke Direktur —
--     bahkan sesudah datanya dibetulkan. Kebetulan Finance menulis koreksinya
--     sebagai pesan biasa, bukan "tidak R3", jadi kita lolos dari jebakan ini.
--     Kolom `riwayat` menyimpan keputusan lama supaya draft baru boleh dibuat
--     TANPA menghapus jejak penolakannya.
--
--  2. SELISIH TAK BISA DILACAK. Finance melihat "masuk Rp 338.252.787" di
--     balasan ingest, lalu "Rp 138.252.787" di draft — dan harus mengurangi
--     sendiri untuk tahu selisihnya dari mana. Rekonsiliasi per rekening
--     dihitung dari data yang sudah ada (tak butuh kolom baru), tapi butuh
--     nomor rujukan untuk baris yang tertahan → `kode_triage`.
--
--  3. FINANCE TAK BISA MEMBETULKAN SENDIRI dari WhatsApp. `kode_triage` itulah
--     yang membuat "#KORAN triage T1 uang masuk" mungkin: nomor pendek yang
--     stabil antara pesan draft dan balasan, dan tak menuntut orang menyalin
--     uuid.

-- ─────────────────────────────────────────────────────────────────────────────
-- Riwayat keputusan resume
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cashin_resume ADD COLUMN IF NOT EXISTS riwayat jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN cashin_resume.riwayat IS 'F-CASHIN — keputusan-keputusan SEBELUMNYA atas tanggal ini (kode, status, oleh, alasan, waktu). Diisi saat draft disusun ulang sesudah ditolak/dikoreksi. Menyusun ulang TIDAK boleh menghapus jejak penolakan: alasan penolakan itu sering satu-satunya catatan kenapa angkanya berubah.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Nomor rujukan baris tertahan
-- ─────────────────────────────────────────────────────────────────────────────
-- 'T1', 'T2', … per TANGGAL. Dipakai di pesan draft dan di balasan WA
-- ("#KORAN triage T1 uang masuk"). Nomor pendek, bukan uuid: yang mengetiknya
-- manusia di HP.
ALTER TABLE bank_statement_line ADD COLUMN IF NOT EXISTS kode_triage text;
COMMENT ON COLUMN bank_statement_line.kode_triage IS 'F-CASHIN — nomor rujukan pendek (T1, T2, …) untuk baris yang menunggu keputusan manusia. Diberikan saat draft disusun, dan TIDAK dipakai ulang untuk baris lain di tanggal yang sama selama masih tertahan.';

CREATE INDEX IF NOT EXISTS bank_statement_line_kode_triage_idx
  ON bank_statement_line (kode_triage) WHERE kode_triage IS NOT NULL;
