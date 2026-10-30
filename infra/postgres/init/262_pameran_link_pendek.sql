-- 262 — F173: link pendek (penyingkat luar, mis. s.id / bit.ly) per acara.
--
-- Keputusan user 30 Okt 2026: QR & alamat yang ditampilkan ke pengunjung memakai link pendek
-- buatan sendiri (enak dibacakan MC / diketik penonton). Link dibuat di layanan luar oleh tim —
-- WRG-OS hanya menyimpan & memakainya untuk QR (kartu acara, PNG, layar panggung). NULL = pakai
-- alamat asli /daftar/<slug>. Hanya https. Additive & idempoten.
alter table public.pameran
  add column if not exists link_pendek text check (link_pendek is null or link_pendek ~ '^https://[^[:space:]]{4,200}$');
