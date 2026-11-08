-- 292 — F150: catat dokumen Accurate yang SUDAH diperiksa puller biaya, termasuk yang
-- tak menghasilkan baris biaya (pembayaran ke akun selain 6100/6200/6300).
--
-- Tanpa tabel ini, "sudah ditarik?" dibaca dari biaya_area_baris — dokumen non-biaya tak
-- punya baris, jadi diambil ulang di SETIAP run dan menghabiskan kuota detail_limit. Terbukti
-- di prod 8 Nov 2026: tiap putaran 500 dokumen, sisa antrean hanya turun puluhan dan tak
-- pernah 0; job harian (400/hari) tak akan pernah mencapai dokumen biaya baru.
--
-- Dokumen ditarik ulang hanya bila lastUpdate Accurate-nya lebih baru dari yang tercatat.
-- Isian awal dari biaya_area_baris (dokumen yang sudah punya baris). Idempoten; tanpa
-- BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS biaya_area_dokumen (
  sumber               text        NOT NULL CHECK (sumber IN ('other-payment', 'purchase-invoice', 'journal-voucher')),
  accurate_id          bigint      NOT NULL,
  accurate_last_update timestamptz,
  n_baris              integer     NOT NULL DEFAULT 0,
  diperiksa_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sumber, accurate_id)
);

INSERT INTO biaya_area_dokumen (sumber, accurate_id, accurate_last_update, n_baris)
SELECT sumber, accurate_id, max(accurate_last_update), count(*)::int
FROM biaya_area_baris
GROUP BY sumber, accurate_id
ON CONFLICT (sumber, accurate_id) DO NOTHING;

COMMENT ON TABLE biaya_area_dokumen IS
  'F150 (292) — dokumen Accurate yang sudah diperiksa puller biaya (termasuk 0 baris biaya); ditarik ulang hanya bila lastUpdate berubah.';
