-- 179 — F-CASHIN: pernyataan "hari ini nihil" untuk rekening tanpa transaksi.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.
--
-- Sebabnya dari lapangan (Finance, 18 Sep 2026): "jika di tgl 17 untuk Bank BNI
-- tidak ada transaksi apakah tetap dishare, karena di internet banking tidak
-- bisa didownload karena tidak ada transaksi."
--
-- Tanpa jalan ini, rekening yang memang tak bertransaksi menahan hitungan
-- kelengkapan SELAMANYA: resume berhenti di 4/10, label "BELUM LENGKAP"
-- menempel permanen, dan nama rekening itu terus muncul di daftar "belum setor"
-- seolah Finance lalai padahal sudah benar.
--
-- Dua keputusan yang menentukan bentuk kolom di bawah:
--
--  1. NIHIL ADALAH PERNYATAAN BERTANDA TANGAN, BUKAN KETIADAAN DATA. Kalau
--     ketiadaan file diam-diam dianggap nihil, hari yang benar-benar TERLEWAT
--     tak bisa dibedakan dari hari yang memang tak ada transaksi — dan itu
--     menghapus satu-satunya penjaga kelengkapan yang dipunyai fitur ini.
--     Karena itu ada `nihil_oleh`: siapa yang menyatakan, tercatat.
--
--  2. TIDAK BISA DIVERIFIKASI MESIN. Pernyataan nihil tak punya angka untuk
--     dicocokkan. Yang bisa menangkap pernyataan keliru cuma statement hari
--     BERIKUTNYA (saldo awalnya tak akan bersambung) — dan itu ketahuan
--     belakangan, bukan saat disetor. Jejak `nihil_oleh` itulah gantinya.

ALTER TABLE bank_statement ADD COLUMN IF NOT EXISTS nihil boolean NOT NULL DEFAULT false;
ALTER TABLE bank_statement ADD COLUMN IF NOT EXISTS nihil_oleh text;

COMMENT ON COLUMN bank_statement.nihil IS 'F-CASHIN — true = rekening dinyatakan TIDAK ada transaksi hari itu (bukan "koran belum disetor"). Ikut dihitung sebagai sudah setor di hitungan kelengkapan, tapi dilaporkan terpisah di resume — JANGAN dirender sebagai Rp 0, karena nol tak bisa dibedakan dari "datanya belum ada".';
COMMENT ON COLUMN bank_statement.nihil_oleh IS 'F-CASHIN — nama/nomor WA orang yang menyatakan nihil. Wajib ada isinya untuk baris nihil: pernyataan yang tak bisa diverifikasi mesin harus bisa ditelusuri ke orangnya.';

-- Penjaga bentuk data: baris nihil tak boleh punya pernyata yang kosong, dan
-- baris biasa tak boleh mengaku punya pernyata. Ditegakkan di DB supaya jalur
-- tulis mana pun (WA, menu web, skrip ops) tak bisa melewatinya.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_statement_nihil_oleh_chk') THEN
    ALTER TABLE bank_statement ADD CONSTRAINT bank_statement_nihil_oleh_chk
      CHECK ((nihil = false AND nihil_oleh IS NULL) OR (nihil = true AND nihil_oleh IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS bank_statement_nihil_idx ON bank_statement (tanggal, nihil) WHERE nihil;
