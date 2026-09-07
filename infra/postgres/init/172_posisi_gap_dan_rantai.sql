-- 172 — Dua hal yang dibutuhkan UI untuk menampilkan jembatan posisi↔karyawan
-- secara JUJUR: alasan kenapa seseorang BELUM tertaut, dan rantai
-- orang → posisi → proses.
--
-- ── employee_posisi_gap ────────────────────────────────────────────────────
-- KENAPA DIPERSIST, BUKAN DIHITUNG ULANG DI SQL: alasan tak-tertaut adalah
-- keluaran logika pencocokan di scripts/ops/posisi-employee-match.mjs
-- (containment asimetris + syarat posisi unik + syarat kapasitas + tie-break
-- alias). Menulis ulang logika itu sebagai view berarti dua sumber kebenaran
-- yang PASTI menyimpang begitu salah satu disentuh — dan menyimpangnya tak
-- akan berisik, cuma memberi alasan yang salah di layar. Jadi skrip yang
-- sudah menghitungnya sekalian menuliskannya.
--
-- Tabel ini MILIK SKRIP sepenuhnya (diganti total tiap run). Tak ada kolom
-- yang boleh disunting orang di sini; keputusan manusia tempatnya di
-- posisi_employee dengan sumber='manual', dan begitu seseorang tertaut,
-- barisnya di sini hilang sendiri pada run berikutnya.
--
-- Sengaja TANPA kolom "posisi kandidat terpilih" — kalau matcher sampai bisa
-- memilih, orangnya bukan gap lagi. Kolom `kandidat` hanya daftar mentah untuk
-- ditampilkan supaya HoD tahu pilihannya apa saja.

CREATE TABLE IF NOT EXISTS employee_posisi_gap (
  employee_id text PRIMARY KEY REFERENCES employee(id) ON DELETE CASCADE,
  alasan      text NOT NULL,
  kandidat    text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE employee_posisi_gap IS
  'Karyawan yang BELUM punya baris di posisi_employee, beserta alasannya. Ditulis penuh oleh scripts/ops/posisi-employee-match.mjs — jangan disunting tangan; keputusan manusia masuk ke posisi_employee (sumber=manual).';
COMMENT ON COLUMN employee_posisi_gap.alasan IS
  'Apa adanya dari matcher, mis. "kapasitas ''Kirim Tagih'' 1 tapi 12 orang cocok" atau "nama posisi (atau alias-nya) tidak termuat di role".';

-- ── v_raci_karyawan_posisi ─────────────────────────────────────────────────
-- Rantai orang → posisi → proses. Inilah yang tak bisa dijawab menu mana pun
-- sebelumnya: /people/raci tahu orang↔proses versi transkrip (raci_assignment),
-- /sop-otomasi tahu posisi↔proses versi form, tapi tak ada yang menyambung
-- keduanya. Sekarang posisi_employee menyambungkannya.
--
-- Satu baris = satu pasangan (karyawan, posisi). Seorang karyawan bisa punya
-- BEBERAPA baris — Enggar & Nopa masing-masing memegang 2 posisi. `proses`
-- dihitung per posisi, bukan per orang, supaya penjumlahan di aplikasi tidak
-- menggandakan proses milik posisi yang dirangkap dua orang.
CREATE OR REPLACE VIEW v_raci_karyawan_posisi AS
SELECT e.id                AS employee_id,
       e.nama              AS karyawan,
       e.panggilan,
       e.dept,
       e.cabang,
       e.role              AS role_roster,
       p.id                AS posisi_id,
       p.nama              AS posisi,
       p.jumlah_orang,
       d.key               AS divisi_key,
       d.label             AS divisi,
       pe.sumber,
       pe.catatan          AS dasar_tautan,
       count(t.id)::int    AS proses
FROM employee e
JOIN posisi_employee pe ON pe.employee_id = e.id
JOIN posisi p           ON p.id = pe.posisi_id
JOIN divisi d           ON d.key = p.divisi_key
LEFT JOIN posisi_tugas t ON t.posisi_id = p.id
GROUP BY e.id, e.nama, e.panggilan, e.dept, e.cabang, e.role,
         p.id, p.nama, p.jumlah_orang, d.key, d.label, d.seq, pe.sumber, pe.catatan
ORDER BY d.seq, p.nama, e.nama;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON employee_posisi_gap, v_raci_karyawan_posisi TO wrg_readonly;
  END IF;
END $$;
