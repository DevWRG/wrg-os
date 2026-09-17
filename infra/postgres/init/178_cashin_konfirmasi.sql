-- 178 — F-CASHIN: gerbang konfirmasi Finance sebelum resume dikirim ke Direktur.
--
-- Idempoten. CATATAN: TIDAK memanggil BEGIN/COMMIT sendiri — runner
-- (scripts/db/migrate.sh) yang mengatur transaksi.
--
-- Perubahan alur yang dimintakan user 2026-09-17:
--
--   sebelum : cron 17:30 → hitung resume → DM Direktur. Tanpa manusia.
--   sesudah : koran lengkap → draft resume dikirim ke GRUP tempat #KORAN
--             disetor → Finance balas "ya <kode>" / "tidak <kode> <alasan>" →
--             baru resume dikirim ke Direktur.
--
-- Empat keputusan yang menentukan bentuk skema di bawah:
--
--  1. SATU BARIS PER TANGGAL (UNIQUE tanggal). Resume itu laporan harian; dua
--     baris untuk hari yang sama berarti dua angka berbeda beredar dan tak ada
--     yang tahu mana yang dikirim ke Direktur. Re-ingest koran hari itu
--     MEMPERBARUI teks draft yang masih menunggu, bukan membuat draft kedua.
--
--  2. KODE PENDEK SENDIRI, bukan uuid. Finance membalas dari HP: "ya R12".
--     Menyuruh orang mengetik uuid = jaminan salah ketik. Pola ini menyalin
--     detect_leave ('ya L3'), termasuk alasannya: id yang muncul di layar WA
--     harus cukup pendek untuk diketik ulang tanpa copy-paste.
--
--  3. STATUS 'terkirim' TERPISAH dari 'dikonfirmasi'. Konfirmasi Finance dan
--     keberhasilan kirim ke Direktur adalah dua kejadian berbeda: gateway WA
--     bisa gagal SESUDAH Finance menyetujui. Digabung jadi satu status, resume
--     yang gagal terkirim akan terlihat seperti belum disetujui dan Finance
--     diminta menyetujui ulang sesuatu yang sudah ia setujui.
--
--  4. JEJAK PESAN YANG SUDAH DIBACA (cashin_konfirmasi_seen). Balasan "ya R12"
--     TIDAK punya hashtag, jadi ia tak lewat pipeline processUnprocessed yang
--     menyaring wa_message dengan pola hashtag — pemindainya berdiri sendiri
--     dan butuh penanda idempotensinya sendiri. Sama persis alasan
--     leave_scan_seen ada di detect_leave.

-- ─────────────────────────────────────────────────────────────────────────────
-- Asal statement: grup WA tempat #KORAN disetor
-- ─────────────────────────────────────────────────────────────────────────────
-- Draft konfirmasi dikirim BALIK ke grup asal, bukan ke JID yang dikonfigurasi
-- terpisah (keputusan user: "balas di grup asal #KORAN"). Supaya itu mungkin,
-- grup asalnya harus tersimpan — wa_message_id saja tidak cukup karena baris
-- wa_message bisa hilang (ON DELETE SET NULL) sementara statement-nya tetap ada.
ALTER TABLE bank_statement ADD COLUMN IF NOT EXISTS wa_group_jid text;
COMMENT ON COLUMN bank_statement.wa_group_jid IS 'F-CASHIN — grup WA tempat #KORAN disetor. Dipakai sebagai tujuan draft konfirmasi Finance. NULL untuk statement yang diunggah lewat menu web.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Resume harian + status konfirmasinya
-- ─────────────────────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS cashin_resume_kode_seq;

CREATE TABLE IF NOT EXISTS cashin_resume (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal            date NOT NULL UNIQUE,
  -- 'R12'. Dipakai Finance saat membalas di WA; ditampilkan juga di menu web.
  kode               text NOT NULL UNIQUE DEFAULT ('R' || nextval('cashin_resume_kode_seq')),

  teks               text NOT NULL,          -- isi resume apa adanya (yang akan dikirim ke Direktur)
  ringkasan          jsonb,                  -- angka penyusunnya, untuk audit kalau teksnya diperdebatkan

  status             text NOT NULL DEFAULT 'menunggu_konfirmasi'
                     CHECK (status IN ('menunggu_konfirmasi', 'ditolak', 'terkirim', 'gagal_kirim')),

  grup_jid           text,                   -- tujuan draft (grup asal #KORAN)
  draft_terkirim_at  timestamptz,            -- kapan draft sampai ke Finance; NULL = draft belum pernah dikirim
  ingat_terakhir_at  timestamptz,            -- pengingat terakhir, supaya tak mengingatkan berkali-kali sehari

  diputuskan_oleh    text,                   -- nama/nomor WA pembalas, atau email user web
  diputuskan_at      timestamptz,
  alasan_tolak       text,
  -- message_id balasan yang menjadi dasar keputusan. Tanpa ini, "siapa yang
  -- menyetujui angka 4 September" cuma bersandar pada pushname WA yang bisa
  -- diubah pemiliknya kapan saja.
  wa_message_id      uuid REFERENCES wa_message(id) ON DELETE SET NULL,

  terkirim_at        timestamptz,
  kirim_error        text,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cashin_resume_status_idx ON cashin_resume (status, tanggal DESC);
COMMENT ON TABLE cashin_resume IS 'F-CASHIN — satu resume harian + gerbang konfirmasi Finance. Resume HANYA boleh sampai ke Direktur lewat status terkirim, yang cuma bisa dicapai setelah Finance membalas "ya <kode>".';
COMMENT ON COLUMN cashin_resume.status IS 'menunggu_konfirmasi = draft sudah/akan dikirim ke Finance; ditolak = Finance membatalkan (alasan_tolak wajib diisi kalau disebut); terkirim = sudah sampai ke Direktur; gagal_kirim = Finance sudah setuju TAPI gateway WA gagal — perlu dicoba lagi, BUKAN perlu disetujui ulang.';
COMMENT ON COLUMN cashin_resume.kode IS 'Kode pendek untuk dibalas di WA ("ya R12"). Pola & alasannya sama dengan L<id> di detect_leave: harus bisa diketik ulang dari HP tanpa copy-paste.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotensi pemindai balasan
-- ─────────────────────────────────────────────────────────────────────────────
-- Pesan "ya R12" tidak ber-hashtag → processUnprocessed tidak menyentuhnya dan
-- processed_at-nya tetap NULL selamanya. Kalau pemindai ini bersandar pada
-- processed_at, ia akan memproses balasan yang sama tiap kali webhook jalan;
-- kalau ia MENULIS processed_at, ia mencuri baris dari pipeline hashtag.
-- Tabel sendiri = dua pipeline tidak saling menimpa.
CREATE TABLE IF NOT EXISTS cashin_konfirmasi_seen (
  message_id uuid PRIMARY KEY REFERENCES wa_message(id) ON DELETE CASCADE,
  status     text NOT NULL,          -- diputuskan | bukan-keputusan | kode-tak-dikenal | sudah-final
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE cashin_konfirmasi_seen IS 'F-CASHIN — jejak pesan grup yang sudah dinilai pemindai konfirmasi resume. Terpisah dari wa_message.processed_at karena balasan konfirmasi tidak ber-hashtag (lihat catatan di kepala migrasi 178).';
