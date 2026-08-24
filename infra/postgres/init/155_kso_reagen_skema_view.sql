-- 155 — aturan "baris reagen ini masuk revenue skema atau tidak" pindah ke view.
--
-- SEBABNYA permintaan export xlsx multi-sheet: sheet Reagen butuh status dalam/luar
-- skema per baris (tanpa itu kolom nilainya dijumlahkan orang dan tidak cocok dengan
-- revenue — cacat #1023 yang berpindah dari layar ke berkas). Aturan itu sekarang
-- ditulis INLINE di apps/api/src/repo/kso-produktivitas.ts, di query dialog detail.
--
-- Menuliskannya kedua kali untuk query export berarti dua definisi yang akan menyimpang.
-- Itu pola yang sudah kena TIGA KALI di rangkaian ini — 107 (aturan atribusi disalin ke
-- tiap migrasi), #998 (porsi diturunkan di TS lalu pecah dalam sehari saat 121 masuk),
-- dan 125/126 (blok porsi disalin ke tren, selisih Rp 640 jt). Tiap kali gejalanya sama:
-- tidak ada error, cuma dua angka yang berbeda dan cuma ketemu kalau ada yang
-- membandingkan.
--
-- Jadi aturannya dipindah ke SINI dan KEDUA pemakainya membacanya — dialog detail dan
-- export. Ini bukan penambahan aturan baru: isinya persis ekspresi yang sudah berjalan.
--
-- ── KENAPA SKEMA IKUT JADI KOLOM ─────────────────────────────────────────────────
-- `kso_faskes_reagen_v` (120) tidak punya kolom skema — reagen milik FASKES, dan status
-- dalam/luar skema baru punya arti setelah skemanya ditentukan. Faskes berskema ganda
-- karena itu memunculkan baris reagen yang SAMA dua kali di view ini, sekali per skema,
-- dengan `dalam_skema` yang bisa berbeda. Itu disengaja dan wajib: item PEMERIKSAAN
-- 3DIFF pada faskes yang punya Hematology 3Diff di BELI_REAGEN saja akan `dalam_skema`
-- di sisi itu dan TIDAK di sisi PER_TEST.
--
-- KONSEKUENSI YANG HARUS DIJAGA PEMAKAI: jangan menjumlahkan view ini tanpa memfilter
-- skema, atau nilai faskes berskema ganda terhitung dua kali. Pemakai yang ada
-- (dialog detail & export) selalu memfilter satu skema.
--
-- Verifikasi setelah apply:
--   -- 1. baris ganda HANYA pada faskes berskema ganda:
--   SELECT count(*) FROM (
--     SELECT account_id, periode, item_id, kategori, unit FROM kso_faskes_reagen_skema_v
--     GROUP BY 1,2,3,4,5 HAVING count(*) > 1) x;
--   -- harus = jumlah baris reagen milik faskes berskema ganda, bukan 0
--
--   -- 2. sepadan dengan ekspresi lama untuk satu skema (harus 0 selisih):
--   SELECT round(sum(nilai_netto)) FROM kso_faskes_reagen_skema_v
--   WHERE skema='BELI_REAGEN' AND dalam_skema;

CREATE OR REPLACE VIEW kso_faskes_reagen_skema_v AS
SELECT r.account_id, a.skema, r.periode,
       r.item_id, r.item_no, r.item_nama, r.jenis_alat,
       r.kategori, r.unit, r.qty, r.nilai_netto, r.jumlah_faktur,
       -- Dua jalan masuk, sama seperti di 124/125: kategori pengadaan yang berlaku bagi
       -- skema, ATAU penagihan per-tes yang diakui (item PEMERIKSAAN yang jenis alatnya
       -- dimiliki faskes pada skema ini).
       (r.kategori IN (SELECT ks.kategori FROM kso_kategori_skema ks WHERE ks.skema = a.skema)
        OR EXISTS (SELECT 1 FROM kso_penagihan_tes_v pt
                   WHERE pt.account_id = r.account_id AND pt.skema = a.skema
                     AND pt.item_id = r.item_id))                       AS dalam_skema,
       -- Dipakai UI/export menyebut ALASAN yang benar saat baris tak masuk skema: untuk
       -- item PEMERIKSAAN sebabnya bukan kategorinya (semuanya 'Tanpa kategori', dan
       -- sebagiannya justru diakui) melainkan jenis alatnya tak dimiliki. Lihat #1021.
       (r.item_id IN (SELECT p.item_id FROM kso_item_pemeriksaan_v p)) AS penagihan_tes,
       -- NILAI TERALOKASI PORSI — kolom ini yang harus dipakai kalau angkanya akan
       -- dibandingkan dengan kartu Revenue netto atau grafik.
       --
       -- Tanpa ini, pemakai memakai `nilai_netto` mentah dan hasilnya BEDA dari kartu:
       -- terukur di dev saat view ini dibuat, BELI_REAGEN Rp 188.840.000 (mentah) vs
       -- Rp 148.840.000 (ber-porsi). Selisih itu porsi KSO faskes berskema ganda — dan
       -- membiarkan pemakai mengalikannya sendiri berarti aturan porsi hidup di tempat
       -- ketiga, tepat hal yang migrasi ini ada untuk menghentikan.
       --
       -- Hanya kategori 'KSO' yang dibagi porsi; kategori lain (REGULAR/RUTIN) sudah
       -- spesifik ke satu sisi. Aturan yang sama dengan 102/121/122.
       --
       -- Porsi DIBACA dari kso_asset_produktivitas_v — sumber tunggalnya setelah 126.
       -- COALESCE ke 1 aman di sini karena join di bawah sudah memastikan faskes punya
       -- aset pada skema ini, dan invarian "porsi NULL tidak pernah bertemu faktur KSO"
       -- sudah diuji di 126. Kalau invarian itu pecah, yang terjadi nilai TIDAK dibagi
       -- (bukan hilang) — dan itu akan terlihat sebagai selisih terhadap kartu.
       CASE WHEN r.kategori = 'KSO'
            THEN r.nilai_netto * COALESCE(pk.porsi_kso, 1)
            ELSE r.nilai_netto END                                      AS nilai_netto_skema
FROM kso_faskes_reagen_v r
JOIN (SELECT DISTINCT account_id, skema FROM kso_asset
      WHERE account_id IS NOT NULL AND skema IN ('PER_TEST','BELI_REAGEN')) a
  ON a.account_id = r.account_id
LEFT JOIN (SELECT DISTINCT account_id, skema, porsi_kso FROM kso_asset_produktivitas_v) pk
  ON pk.account_id = r.account_id AND pk.skema = a.skema;

COMMENT ON VIEW kso_faskes_reagen_skema_v IS
  'Reagen per faskes x SKEMA dengan status dalam_skema & penagihan_tes. SUMBER TUNGGAL aturan "masuk revenue skema atau tidak" (migrasi 155) — dibaca dialog detail DAN export xlsx; sebelumnya ditulis inline di TypeScript. PAKAI nilai_netto_skema (sudah dikali porsi KSO) kalau angkanya dibandingkan dengan kartu/grafik; nilai_netto mentah tidak dibagi porsi. Faskes berskema ganda muncul dua kali (sekali per skema) dengan dalam_skema yang bisa berbeda: JANGAN dijumlahkan tanpa memfilter skema.';
