-- 265 — F170 v2 (Pedoman Komite KSO Forum v01, Fase C1): nilai enum untuk zona AM
--
-- Pedoman: GPM deal ≥ 55% + tujuh gerbang hijau → AM sendiri yang memutus (keputusan user 31 Okt:
-- langsung jadi mandat otomatis). Butuh status & jalur baru. ADD VALUE dipisah dari 266 karena nilai
-- enum baru tidak boleh DIPAKAI di transaksi yang sama (migrate.sh: satu berkas = satu transaksi).
-- Idempoten. Tidak memanggil BEGIN/COMMIT sendiri.

alter type kso.status_rencana add value if not exists 'DIPUTUS_AM' before 'DIPUTUS_HOD';
alter type kso.jalur add value if not exists 'AM' before 'CEPAT';
