-- 261 — F173: jatah pendaftaran per IP diatur PER ACARA.
--
-- Uji beban 30 Okt 2026: 500 pengunjung dari SATU IP (Wi-Fi venue / CGNAT operator seluler)
-- dengan jatah tetap 40 → 460 ditolak. Momen panggung (QR di layar, ±1.800 penonton scan
-- bersamaan) butuh jatah jauh lebih besar dari booth biasa, jadi angkanya kolom acara —
-- diubah dari form Pameran tanpa rilis (keputusan user). Satuan: pendaftaran per 10 menit.
-- Additive & idempoten.
alter table public.pameran
  add column if not exists jatah_ip integer not null default 600 check (jatah_ip between 10 and 100000);
