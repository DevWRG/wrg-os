-- 287 — Pemetaan nama alat di Populasi Alat (kso_asset.nama_alat, teks bebas
-- dari sheet) → kode item Accurate. Dipakai form Instalasi: setelah alat dipilih
-- dari katalog Accurate, daftar SN yang disarankan = SN populasi dengan nama
-- alat yang terpetakan ke item itu (keputusan user 7 Nov 2026).
--
-- Kenapa tabel, bukan pencocokan teks saat query: nama populasi & nama Accurate
-- beda gaya ("Zybio Z3" vs "ZYBIO HEMATOLOGY ANALYZER 3 DIFF Z3"), dan satu
-- nama bisa tampak cocok ke dua item ("Z3" vs "Z3 CRP"). Pemetaan ditinjau
-- orang sekali, lalu stabil.
--
-- Kenapa bukan SN dari Accurate: item alat di Accurate TIDAK disetel sebagai
-- barang ber-Serial Number (probe report/serial-number-per-warehouse.do
-- 7 Nov 2026: "Barang yang dicari bukan merupakan barang dengan Serial
-- Number." untuk IDS.0227/0131/0224/0030).
--
-- Kunci = lower(btrim(nama_alat)). Satu item boleh dipetakan dari beberapa nama
-- (mis. "Metrolab 1600DR" & "Wienerlab 1600DR" → IDS.0143). yakin=false =
-- tebakan terbaik yang perlu dicek; tetap dipakai sebagai saran.
-- Seed: 49 dari 63 nama (520 dari 562 unit); 14 nama tak punya padanan di
-- katalog alat Accurate. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS alat_item_map (
  nama_alat_key text PRIMARY KEY,
  nama_alat     text NOT NULL,
  item_no       text NOT NULL,
  yakin         boolean NOT NULL DEFAULT true,
  catatan       text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alat_item_map_item_idx ON alat_item_map (upper(item_no));

INSERT INTO alat_item_map (nama_alat_key, nama_alat, item_no, yakin)
SELECT lower(btrim(v.nama)), v.nama, v.item_no, v.yakin
FROM (VALUES
  ('BIOCHEMICAL SYSTEM INTERNASIONAL SRL', 'IDS.0027', true),
  ('Biocross Incubator', 'IDS.0144', true),
  ('Biolis 24i', 'IDS.0242', true),
  ('Biolis 50i', 'IDS.0243', true),
  ('Clover A1c', 'IDS.0030', true),
  ('DORA HEMODIALISA MACHINE 6000', 'IDS.0279', true),
  ('DUS R-50S', 'IDS.0218', true),
  ('Ediagnosis PT1000', 'IDS.0307', true),
  ('Erba EC 90', 'IDS.0137', true),
  ('Erba ECL 105', 'IDS.0245', true),
  ('Erba ECL 412', 'IDS.0244', true),
  ('Erba H-360', 'IDS.0156', true),
  ('Eti Max 3000', 'IDS.0174', true),
  ('Fresenius 4008 S', 'IDS.0276', true),
  ('I Smart 30', 'IDS.0186', true),
  ('ISMART 300', 'IDS.0135', false),
  ('K Lyte 5', 'IDS.0166', true),
  ('KONSUNG', 'IDS.0200', false),
  ('MEK-6318', 'IDS.0078', true),
  ('MEK-6410', 'IDS.0160', true),
  ('MEK-6510', 'IDS.0079', true),
  ('MEK-7222', 'IDS.0165', true),
  ('MEK-7300', 'IDS.0080', true),
  ('MEK-8222', 'IDS.0081', true),
  ('Metrolab 1600DR', 'IDS.0143', true),
  ('Metrolab 2300', 'IDS.0075', true),
  ('Mindray BC20s', 'IDS.0249', true),
  ('Pictus 400', 'IDS.0089', true),
  ('SCLAVO LED 10 ANALYZER', 'IDS.0262', false),
  ('SHM Diagnostika', 'IDS.0184', true),
  ('T-Coag KC1', 'IDS.0115', true),
  ('T-Coag KC4', 'IDS.0136', true),
  ('TMS 50i', 'IDS.0243', false),
  ('Tosoh AiA 360', 'IDS.0285', true),
  ('URIN DUS R300', 'IDS.0133', true),
  ('VesMatic 10', 'IDS.0033', false),
  ('Wienerlab 1600DR', 'IDS.0143', true),
  ('Wienerlab CM250', 'IDS.0134', true),
  ('Wondfo BGA-102', 'IDS.0270', true),
  ('Wondfo FIA Meter', 'IDS.0129', false),
  ('Wondfo FIA Meter III FS205', 'IDS.0306', true),
  ('Wondfo OCG 102', 'IDS.0158', true),
  ('Zybio EXC200', 'IDS.0226', true),
  ('Zybio EXC220', 'IDS.0298', true),
  ('Zybio EXZ 6000', 'IDS.0225', true),
  ('ZYBIO IMMUNOCHROMATOGRAPHY EXR110', 'IDS.0299', true),
  ('Zybio Z3', 'IDS.0131', false),
  ('Zybio Z50', 'IDS.0224', true),
  ('Zybio Z52', 'IDS.0254', true)
) AS v(nama, item_no, yakin)
ON CONFLICT (nama_alat_key) DO NOTHING;

COMMENT ON TABLE alat_item_map IS 'Nama alat Populasi (kso_asset.nama_alat) → kode item Accurate; sumber saran SN di form Instalasi (287).';
