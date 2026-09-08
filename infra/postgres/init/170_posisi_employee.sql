-- 170 — Jembatan posisi (migrasi 168, grain posisi/divisi dari form PIC) ↔
-- employee (migrasi 052, grain karyawan dari transkrip).
--
-- N:M, BUKAN kolom posisi_id di employee. Alasannya ada di datanya sendiri:
-- kata "merangkap" bertebaran di employee.role — "Koordinator Tim Teknisi
-- (Aftersales) merangkap Admin Teknisi", "SPV Admin Cabang — Madura (merangkap
-- Kirim-Tagih)", "Admin Distribusi merangkap Admin Purchasing" — dan sheet
-- 'Daftar Posisi' form Aftersales mencantumkan Enggar & Nopa di DUA posisi
-- sekaligus. Satu orang memang memegang lebih dari satu posisi. Kolom tunggal
-- akan memaksa memilih salah satu dan membuang sisanya.
--
-- `employee` TIDAK diubah sama sekali (tak ada ALTER) — migrasi 052/053 tetap
-- pemilik tabel itu, dan /people/raci · /people/voice · /raport tak terpengaruh.
--
-- KOLOM `sumber` ADALAH INTI TABEL INI, bukan metadata hiasan. Pencocokan
-- posisi↔orang di data ini TIDAK bisa dituntaskan mesin (lihat blok berikut),
-- jadi tiap baris harus membawa DASAR-nya supaya bisa ditinjau & dicabut
-- selektif. Nilai yang dipakai:
--   'nama_di_catatan'    — nama orangnya tertulis di posisi.catatan (bukti terkuat)
--   'nama_posisi_di_role'— seluruh kata posisi.nama muncul di employee.role,
--                          hanya SATU posisi yang cocok utk orang itu, DAN
--                          jumlah pengklaim tidak melebihi posisi.jumlah_orang
--   'manual'             — diputuskan orang (HoD/PIC), lewat UI atau SQL
-- Skrip pencocokan HANYA boleh menulis dua yang pertama. 'manual' milik manusia
-- dan importer tak pernah menyentuhnya.
--
-- KENAPA TIDAK ADA PENCOCOKAN FUZZY DI SINI (dan jangan ditambahkan):
-- prototipe skor kemiripan teks (IDF + token overlap) diuji atas data nyata dan
-- GAGAL dengan cara yang berbahaya, bukan cara yang berisik:
--   • 'Account Manager (Marketing) — baru pindah dari Kirim-Tagih' di-skor 0,37
--     ke posisi 'Kirim Tagih' dan lolos sebagai "jelas". Kata itu cuma ada di
--     keterangan RIWAYAT orangnya. Satu AM jadi tercatat sebagai Kirim-Tagih.
--   • posisi HANTU 'Staff AR & CN (Account Receivable & Credit Note)' (baris
--     artefak sheet C, jumlah_orang NULL) MENGALAHKAN posisi aslinya
--     'Staff AR & CN' (0,51 vs 0,31) justru karena namanya lebih panjang.
-- Dua-duanya menghasilkan tautan yang terlihat benar. Karena itu tabel ini
-- sengaja menampung sedikit baris berdasar bukti keras + banyak baris kosong
-- yang menunggu keputusan orang, ketimbang penuh tapi separuhnya salah.

CREATE TABLE IF NOT EXISTS posisi_employee (
  posisi_id   bigint NOT NULL REFERENCES posisi(id)   ON DELETE CASCADE,
  employee_id text   NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  sumber      text   NOT NULL CHECK (sumber IN
                ('nama_di_catatan','nama_posisi_di_role','manual')),
  catatan     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (posisi_id, employee_id)
);

COMMENT ON TABLE posisi_employee IS
  'Jembatan N:M posisi↔employee. Satu orang bisa memegang >1 posisi (merangkap). Baris TANPA jaminan lengkap — lihat v_posisi_employee_gap untuk yang belum tertaut.';
COMMENT ON COLUMN posisi_employee.sumber IS
  'Dasar tautan. Skrip hanya menulis nama_di_catatan & nama_posisi_di_role; ''manual'' milik keputusan orang dan tidak pernah ditimpa skrip.';

CREATE INDEX IF NOT EXISTS idx_posisi_employee_emp ON posisi_employee (employee_id);

-- ---------------------------------------------------------------------------
-- v_posisi_employee — tautan + konteks kedua sisi, siap dibaca UI/laporan.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_posisi_employee AS
SELECT pe.posisi_id,
       p.divisi_key,
       d.label       AS divisi,
       p.nama        AS posisi,
       p.jumlah_orang,
       pe.employee_id,
       e.nama        AS karyawan,
       e.panggilan,
       e.dept,
       e.role,
       e.cabang,
       pe.sumber,
       pe.catatan
FROM posisi_employee pe
JOIN posisi   p ON p.id  = pe.posisi_id
JOIN divisi   d ON d.key = p.divisi_key
JOIN employee e ON e.id  = pe.employee_id;

-- ---------------------------------------------------------------------------
-- v_posisi_employee_gap — SISI YANG BELUM SELESAI, dibuat sengaja supaya
-- ketidaklengkapan terbaca sebagai angka, bukan tersembunyi di balik view yang
-- cuma menampilkan yang sudah tertaut.
--
-- `kapasitas_form` = jumlah_orang dari sheet 'Daftar Posisi'. Ia BUKAN
-- kebenaran: sengaja dibandingkan dengan hitungan karyawan nyata supaya
-- selisihnya kelihatan. Selisih negatif WAJAR pada posisi yang dirangkap
-- (Aftersales: kapasitas 8 utk 6 orang, karena Enggar & Nopa dihitung dua kali).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_posisi_employee_gap AS
-- Agregat posisi dan agregat tautan DIHITUNG TERPISAH, sengaja tidak lewat satu
-- JOIN. Versi pertama view ini menggabungkan keduanya dan kena fan-out: satu
-- posisi dengan 5 karyawan tertaut membuat barisnya berulang 5×, sehingga
-- sum(jumlah_orang) menghitung kapasitasnya 5× juga — Aftersales terbaca
-- "posisi 8, kapasitas 28" padahal 4 posisi berkapasitas 8. count(DISTINCT …)
-- menyelamatkan kolom karyawan_tertaut tapi TIDAK menyelamatkan sum().
WITH posisi_agg AS (
  SELECT p.divisi_key,
         count(*)                                        AS posisi_total,
         count(*) FILTER (WHERE p.jumlah_orang IS NULL)  AS posisi_tanpa_jumlah,
         coalesce(sum(p.jumlah_orang), 0)                AS kapasitas_form
  FROM posisi p GROUP BY 1
), tautan_agg AS (
  SELECT p.divisi_key, count(DISTINCT pe.employee_id) AS karyawan_tertaut
  FROM posisi p JOIN posisi_employee pe ON pe.posisi_id = p.id
  GROUP BY 1
), per_divisi AS (
  SELECT d.key AS divisi_key, d.label AS divisi, d.seq,
         coalesce(pa.posisi_total, 0)        AS posisi_total,
         coalesce(pa.posisi_tanpa_jumlah, 0) AS posisi_tanpa_jumlah,
         coalesce(pa.kapasitas_form, 0)      AS kapasitas_form,
         coalesce(ta.karyawan_tertaut, 0)    AS karyawan_tertaut
  FROM divisi d
  LEFT JOIN posisi_agg pa ON pa.divisi_key = d.key
  LEFT JOIN tautan_agg ta ON ta.divisi_key = d.key
), kandidat AS (
  -- karyawan yang SECARA STRUKTUR bisa menempati divisi itu (lewat
  -- divisi_department). Divisi tanpa pemetaan department -> 0 kandidat, dan itu
  -- temuan: Business IVD & Medical tak punya key department sama sekali.
  SELECT dd.divisi_key, count(*) AS karyawan_kandidat
  FROM divisi_department dd
  JOIN employee e ON e.dept = dd.dept
  GROUP BY 1
)
SELECT pd.divisi_key, pd.divisi,
       pd.posisi_total, pd.posisi_tanpa_jumlah, pd.kapasitas_form,
       coalesce(k.karyawan_kandidat, 0) AS karyawan_kandidat,
       pd.karyawan_tertaut,
       coalesce(k.karyawan_kandidat, 0) - pd.karyawan_tertaut AS karyawan_belum_tertaut,
       round(100.0 * pd.karyawan_tertaut / NULLIF(k.karyawan_kandidat, 0), 1) AS pct_tertaut
FROM per_divisi pd
LEFT JOIN kandidat k ON k.divisi_key = pd.divisi_key
ORDER BY pd.seq;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON posisi_employee, v_posisi_employee, v_posisi_employee_gap
      TO wrg_readonly;
  END IF;
END $$;
