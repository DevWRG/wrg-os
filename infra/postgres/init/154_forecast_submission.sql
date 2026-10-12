-- 107 — F19 Forecast Submission Engine (arahan Direktur, meeting 2026-08-18).
--
-- Alur: sistem scan gudang (F37 item_stock_branch + F38 item_stock_batch)
-- tiap item vs buffer & tanggal ED → usulan forecast otomatis (status
-- 'draft'). Supply Chain edit/sortir usulan itu, baru "ajukan" → masuk
-- approval berjenjang F11 (approval_request, migrasi 106).
--
-- QC forecast SENGAJA diabaikan dulu (arahan Direktur) — hanya SALES
-- forecast. Sinyal "pipeline HOT" (deal.stage Closing/Closing-Won) SENGAJA
-- TIDAK jadi pemicu presisi per-item (deal.product_ids teks bebas, gak ada
-- katalog produk baku — lihat komentar apps/api/src/repo/product.ts) — cuma
-- ditampilkan sbg KONTEKS jumlah deal HOT aktif, bukan trigger otomatis.
-- Pemicu utama TETAP dari 2 sinyal yang datanya presisi: dekat buffer &
-- dekat ED.
--
-- TIDAK ADA hashtag WA #FORECAST di fitur ini (beda dari blueprint lama) —
-- QW1 (yang tadinya jadi entry point WA) di-skip Direktur krn kompleks utk
-- magang, dan alur F19 hasil meeting 100% sistem→Supply Chain→approval,
-- tanpa langkah WA sama sekali.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

-- ── Konfigurasi buffer/safety stock per item per gudang ─────────────────────
-- Accurate KEMUNGKINAN punya field ini secara native, TAPI puller
-- (accurateSync.ts syncItems) cuma minta fields=id,no,name,itemType,
-- unitPrice,quantity,availableToSell,unit1 — nambah field baru ke situ =
-- ubah puller mirror, masuk domain "ERP Postgres mirror tables" yang
-- eksplisit GATED (ONBOARDING.md), bukan ranah magang. Makanya tabel ini
-- input MANUAL Supply Chain, bukan hasil sync — keputusan scope, bukan krn
-- datanya beneran tak eksis di Accurate.
--
-- Beda dari approval_chain_config (F11, cuma 5 baris tetap) — ini BISA
-- ribuan baris (item x gudang), jadi TIDAK di-pre-seed. Baris tak ada =
-- "belum dikonfigurasi" (sama semantik dgn NULL di F11, cuma dimodelkan
-- sbg absennya baris drpd kolom NULL, krn PK-nya sendiri (item,gudang)).
CREATE TABLE IF NOT EXISTS item_stock_buffer (
  item_id        bigint NOT NULL REFERENCES accurate_item (id) ON DELETE CASCADE,
  warehouse_kode text   NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE,
  buffer_qty     numeric(16, 2) NOT NULL CHECK (buffer_qty >= 0),
  updated_by     text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, warehouse_kode)
);

COMMENT ON TABLE item_stock_buffer IS
  'F19 — safety stock per item per gudang, diisi manual Supply Chain. Baris tak ada = belum dikonfigurasi (tak pernah kena alert), bukan default 0.';

-- ── Usulan forecast ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecast_suggestion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id             bigint NOT NULL REFERENCES accurate_item (id) ON DELETE CASCADE,
  warehouse_kode      text   NOT NULL REFERENCES warehouse (kode) ON UPDATE CASCADE,

  -- Snapshot ANGKA & ALASAN saat sistem membuat usulan (bukan live-join) —
  -- jejak "kenapa" usulan ini muncul, walau kondisi gudang berubah belakangan.
  reasons             jsonb NOT NULL DEFAULT '[]',  -- subset ["near_buffer","near_ed"]
  current_qty         numeric(16, 2) NOT NULL,
  buffer_qty          numeric(16, 2),               -- snapshot item_stock_buffer saat itu (NULL kalau trigger cuma dari ED)
  nearest_ed_date     date,                          -- snapshot batch ED terdekat (NULL kalau trigger cuma dari buffer)
  avg_monthly_qty_6m  numeric(16, 2),                -- rata-rata qty terjual/bulan, 6 bulan terakhir (accurate_invoice_item)
  pipeline_hot_count  int NOT NULL DEFAULT 0,        -- KONTEKS saja (lihat komentar atas), bukan trigger

  suggested_qty       numeric(16, 2) NOT NULL,       -- hitungan awal sistem
  final_qty           numeric(16, 2),                -- diedit Supply Chain; NULL = pakai suggested_qty apa adanya
  notes               text,                          -- catatan Supply Chain

  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'dismissed')),
  -- Link ke F11 (approval_request, migrasi 106) SETELAH Supply Chain "ajukan".
  approval_request_id uuid REFERENCES approval_request (id),

  created_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_by         text,
  reviewed_at         timestamptz
);

-- Anti-spam: cuma 1 usulan 'draft' AKTIF per (item, gudang) — generate ulang
-- tak boleh menumpuk duplikat selama satu masih menunggu keputusan Supply
-- Chain. Baris 'submitted'/'dismissed' boleh banyak (histori), makanya
-- partial index (bukan UNIQUE polos di seluruh tabel).
CREATE UNIQUE INDEX IF NOT EXISTS forecast_suggestion_draft_uq
  ON forecast_suggestion (item_id, warehouse_kode) WHERE status = 'draft';

CREATE INDEX IF NOT EXISTS forecast_suggestion_status_idx ON forecast_suggestion (status);

COMMENT ON TABLE forecast_suggestion IS
  'F19 — usulan forecast (auto-generate dari buffer+ED, diedit Supply Chain, submit ke approval_request F11). reasons/angka di-snapshot saat dibuat.';
