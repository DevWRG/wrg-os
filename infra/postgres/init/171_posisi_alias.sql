-- 171 — `posisi_alias`: pernyataan MANUSIA bahwa sebuah frasa di employee.role
-- menamai posisi tertentu, walau ejaannya berbeda dari posisi.nama.
--
-- KENAPA PERLU: uji containment di posisi-employee-match.mjs mensyaratkan
-- SELURUH kata posisi.nama muncul di employee.role. Itu tepat untuk mencegah
-- tautan palsu, tapi ia buta terhadap jabatan yang sama yang ditulis dengan kata
-- lain di dua sumber berbeda — form PIC dan roster karyawan ditulis oleh orang
-- yang berbeda pada waktu yang berbeda:
--   posisi 'AM'                      vs role 'Account Manager (Marketing) — …'
--   posisi 'Staff Fakturis'          vs role 'Fakturis (cetak faktur …)'
--   posisi 'Admin Sales & Penawaran' vs role 'Admin Marketing (Penawaran …)'
--   posisi 'Adm General Affair'      vs role 'Staff General Affairs (GA)'
-- Nol dari empat itu bisa lolos containment, padahal keempatnya jabatan yang sama.
--
-- KENAPA TABEL, BUKAN DAFTAR DI KODE: ekuivalensi jabatan adalah PENGETAHUAN
-- ORGANISASI yang akan terus bertambah setiap form/roster direvisi. Menaruhnya
-- di kode berarti tiap penambahan butuh PR + deploy, dan lebih buruk: dua sumber
-- kebenaran begitu ada UI yang menyuntingnya. Pola sama `pj_alias` (migrasi 168)
-- dan `brand_alias` — nambah ejaan = satu INSERT.
--
-- SETIAP BARIS DI SINI ADALAH KLAIM YANG BISA SALAH, jadi `catatan` wajib
-- menyebut DASAR-nya. Baris yang dasarnya inferensi (bukan konfirmasi orang)
-- ditandai eksplisit supaya bisa dicabut tanpa menebak-nebak mana yang mana.
--
-- TANPA FK ke posisi(divisi_key, nama) — sengaja. Migrasi ini jalan di DB baru
-- saat tabel `posisi` masih KOSONG (datanya masuk lewat pic-form-import.mjs,
-- bukan lewat migrasi), jadi FK akan membuat migrasi gagal di DB bersih. Sebagai
-- gantinya posisi-employee-match.mjs melaporkan alias yang menunjuk posisi tak
-- ada — berisik, bukan senyap. Pola sama `pj_alias` yang juga tanpa FK.

CREATE TABLE IF NOT EXISTS posisi_alias (
  divisi_key  text NOT NULL,
  posisi_nama text NOT NULL,
  alias       text NOT NULL,   -- lower-case; dicocokkan sebagai HIMPUNAN KATA, bukan substring
  dept        text,            -- batasi alias ke satu dept roster; NULL = semua dept divisi itu
  catatan     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (divisi_key, posisi_nama, alias)
);

COMMENT ON TABLE posisi_alias IS
  'Frasa alternatif yang menamai sebuah posisi di employee.role. Dicocokkan sebagai himpunan kata (semua kata alias harus ada di role), bukan substring — supaya "admin marketing" tidak kena "marketing" saja.';
COMMENT ON COLUMN posisi_alias.catatan IS
  'WAJIB menyebut dasar klaim. Baris hasil inferensi (bukan konfirmasi orang) harus menyatakannya.';
COMMENT ON COLUMN posisi_alias.dept IS
  'Pembatas WAJIB DIISI kalau alias-nya kata umum. Contoh nyata: alias ''fakturis'' tanpa pembatas juga kena role "Finance — Pengelola Piutang (atasan Fakturis & Petty Cash)" — kata itu muncul karena orangnya ATASAN Fakturis, bukan Fakturis. Pengklaim jadi 3 utk kapasitas 2, dan syarat kapasitas menolak ketiganya sehingga 2 Fakturis asli ikut hangus. Membatasi ke dept=''fakturis'' menghapus klaim palsu itu tanpa melemahkan apa pun.';

-- Tautan hasil alias dibedakan dari containment langsung, supaya bisa ditinjau
-- & dicabut terpisah kalau ternyata alias-nya keliru.
ALTER TABLE posisi_employee DROP CONSTRAINT IF EXISTS posisi_employee_sumber_check;
ALTER TABLE posisi_employee ADD CONSTRAINT posisi_employee_sumber_check
  CHECK (sumber IN ('nama_di_catatan','nama_posisi_di_role','alias_jabatan','manual'));

-- ---------------------------------------------------------------------------
-- Seed: 4 ekuivalensi DIKONFIRMASI user (Direktur) 2026-09-07, + 1 inferensi.
-- ---------------------------------------------------------------------------
INSERT INTO posisi_alias (divisi_key, posisi_nama, alias, dept, catatan) VALUES
  ('sales_area', 'AM', 'account manager', 'sales',
   'Dikonfirmasi user 2026-09-07. 10 karyawan dept sales ber-role "Account Manager (Marketing) — <area>".'),

  -- ⚠ BARIS INFERENSI, BUKAN KONFIRMASI LANGSUNG. User membenarkan "AM ↔ Account
  -- Manager"; 'Marketing Senior' tidak ikut disebut. Dasarnya hitungan: dept
  -- `sales` berisi 12 orang (10 Account Manager + 2 Marketing Senior) dan form
  -- menetapkan AM jumlah_orang = 12 — jadi kedua Marketing Senior itu terhitung
  -- sebagai AM oleh formnya sendiri. Kalau ternyata mereka jabatan terpisah,
  -- HAPUS BARIS INI saja; tiga baris lain tidak terpengaruh.
  ('sales_area', 'AM', 'marketing senior', 'sales',
   'INFERENSI dari hitungan (dept sales 12 orang = AM jumlah_orang 12), BUKAN konfirmasi langsung — hapus baris ini kalau Marketing Senior jabatan terpisah.'),

  ('finance_sc', 'Staff Fakturis', 'fakturis', 'fakturis',
   'Dikonfirmasi user 2026-09-07. 2 karyawan dept fakturis ber-role "Fakturis (…)"; kapasitas form juga 2. dept WAJIB di sini — tanpa itu role "atasan Fakturis" ikut mengklaim.'),

  ('sales_area', 'Admin Sales & Penawaran', 'admin marketing', 'penawaran',
   'Dikonfirmasi user 2026-09-07. 3 karyawan dept penawaran ber-role "Admin Marketing (Penawaran…)"; kapasitas form juga 3.'),

  ('bd_ga', 'Adm General Affair', 'general affairs', 'ga',
   'Dikonfirmasi user 2026-09-07. Beda ejaan jamak/tunggal: posisi "…Affair" vs role "Staff General Affairs (GA)".')
ON CONFLICT (divisi_key, posisi_nama, alias) DO UPDATE SET
  dept = EXCLUDED.dept, catatan = EXCLUDED.catatan;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON posisi_alias TO wrg_readonly;
  END IF;
END $$;
