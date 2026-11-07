-- F149 (dipersempit) — monitor DO/SJ yang sudah dikirim tapi belum difakturkan
-- (issue #2052). SOP Fakturis: “Melakukan monitoring atas status BON yang
-- belum difakturkan” (mingguan).
--
-- Sumber: cermin Accurate — accurate_delivery_order.status (statusName Accurate:
-- Dikirim / Difaktur Sebagian / Difaktur / Draf). Sisa qty “Difaktur Sebagian”
-- dihitung dari accurate_invoice_item.raw->>'deliveryOrderDetailId'.
-- Keputusan user 7 Nov 2026: DO kategori KSO (ditagih bulanan lewat form
-- perhitungan KSO) dipisah tab tanpa alarm; terlambat = lewat N hari kerja
-- (default 3, Kalender Libur F14 lewat produk_permintaan_hari_kerja);
-- rekap WA menyusul. Additive + idempoten.

CREATE TABLE IF NOT EXISTS do_belum_faktur_param (
  kunci       TEXT PRIMARY KEY,
  nilai       NUMERIC NOT NULL CHECK (nilai >= 0),
  diubah_oleh TEXT,
  diubah_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO do_belum_faktur_param (kunci, nilai) VALUES ('ambang_hari_kerja', 3)
ON CONFLICT (kunci) DO NOTHING;

-- Cari sisa faktur per baris DO (Difaktur Sebagian) tanpa memindai raw jsonb utuh.
CREATE INDEX IF NOT EXISTS accurate_invoice_item_do_detail_idx
  ON accurate_invoice_item ((raw->>'deliveryOrderDetailId'))
  WHERE raw ? 'deliveryOrderDetailId';

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON do_belum_faktur_param TO wrg_app;
  END IF;
END $$;
