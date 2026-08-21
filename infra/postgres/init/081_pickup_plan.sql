-- 081 — Pickup Pre-Visit Verification (F45, SHIPPING): jadwal trip Kirim-Tagih
-- + verifikasi H-1 (hari libur & PIC customer) untuk mencegah "rebound trip"
-- (kurir sudah jalan, customer tutup / PIC tak ada → pulang tanpa hasil).
--
-- KENAPA TABEL BARU, bukan kolom di `shipment_tracking` (F12):
--   1. `shipment_tracking` melacak SIKLUS HIDUP SATU SJ (draft→dikirim→terima→
--      bast) dan semua kolom waktunya PASCA-kejadian. Kolom `eta_date` yang
--      dulu ada malah sudah di-DROP di migrasi 077 (arahan Direktur: ETA
--      upfront dikosongkan) — menambah tanggal rencana ke situ berarti
--      memutar balik keputusan itu.
--   2. Trip "tagih" sering TANPA SJ sama sekali (ambil faktur / tagih
--      pembayaran). Kalau jadwal nempel ke SJ, trip jenis itu tak bisa
--      dijadwalkan padahal justru yang paling rawan rebound (PIC keuangan
--      tak di tempat).
--   3. Satu trip bisa mampir beberapa customer; satu SJ bisa diantar di trip
--      yang mana pun. Relasinya bukan 1-1.
--
-- KENAPA BUKAN `sales_plan`: tabel itu milik alur AM/Teknisi — gate rolenya
-- eksplisit di apps/api/src/repo/inbound.ts (`AM_ROLES = {AM, Teknisi}`), dan
-- staf Kirim-Tagih jatuh ke `sales_todo` yang tak punya kolom customer sama
-- sekali. Jadi jadwal kurir memang belum punya rumah di sistem ini.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

CREATE TABLE IF NOT EXISTS pickup_plan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tanggal RENCANA trip (boleh ke depan). Inilah yang dibaca cron H-1:
  -- `WHERE tanggal = current_date + 1`, pola sama `am_reminder` mode h-minus-1
  -- (apps/api/src/repo/reminder.ts getDue()).
  tanggal     date NOT NULL,

  -- Nama customer TEKS bebas — konsisten dgn `shipment_tracking.customer_name`
  -- dan `sales_plan.customer_name`. Kurir/admin cabang mengetik apa adanya.
  customer_name text NOT NULL,

  -- Jembatan ke PIC (`crm_contact.account_id`). SENGAJA di-resolve SEKALI saat
  -- plan dibuat (dipilih manusia dari daftar customer di form), BUKAN fuzzy
  -- match saat cron jalan: migrasi 068 sudah mencatat jebakannya — beberapa
  -- faskes punya nama SAMA PERSIS (cabang berbeda), dan resolver fuzzy yang
  -- ada (inbound.ts resolveActivityLinks, pg_trgm >= 0.45 LIMIT 1) tak punya
  -- guard keunikan → PIC bisa nempel ke account yang salah. NULL = belum
  -- ditautkan; verifikasi PIC dilewati, bukan menebak.
  account_id  bigint REFERENCES accurate_customer (id) ON DELETE SET NULL,

  cabang      text,        -- cabang/station asal kurir (label informasional)

  -- Tim namanya Kirim-Tagih dan dua-duanya bisa jadi tujuan satu trip.
  tujuan      text NOT NULL DEFAULT 'kirim' CHECK (tujuan IN ('kirim','tagih','kirim+tagih')),

  -- Link OPSIONAL ke SJ (F12) — teks, bukan FK: trip tagih tak punya SJ, dan
  -- `shipment_tracking` belum tentu ada di DB yang sama saat plan dibuat.
  sj_number   text,

  kurir_name      text,
  kurir_wa_number text,    -- tujuan WA hasil verifikasi; kosong → fallback env

  status      text NOT NULL DEFAULT 'rencana' CHECK (status IN ('rencana','selesai','batal')),
  catatan     text,

  -- ── Hasil verifikasi H-1 (diisi cron, bukan manusia) ──────────────────────
  -- Anti-spam per-baris, pola sama `am_reminder.fired_h_minus_1` + F50
  -- `vehicle.stnk_alert_sent_at`: hanya di-set kalau WA BENAR-BENAR terkirim,
  -- supaya cron besok retry kalau gateway gagal (bukan hilang permanen).
  previsit_notified_at timestamptz,
  -- Ringkasan temuan (libur/akhir pekan/PIC kosong) — disimpan biar bisa
  -- dilihat di UI tanpa menjalankan ulang cron.
  previsit_catatan     text,
  -- TRUE = tanggal trip jatuh di hari libur nasional/cuti bersama atau akhir
  -- pekan. Disimpan supaya kolom di tabel web bisa menyorot baris berisiko.
  previsit_bermasalah  boolean NOT NULL DEFAULT false,

  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Cron H-1 selalu query by tanggal + status; index-nya mengikuti itu.
CREATE INDEX IF NOT EXISTS pickup_plan_tanggal_idx ON pickup_plan (tanggal, status);
CREATE INDEX IF NOT EXISTS pickup_plan_account_idx ON pickup_plan (account_id);

COMMENT ON TABLE pickup_plan IS
  'F45 — Jadwal trip Kirim-Tagih (kirim/tagih) + hasil verifikasi H-1: cek hari libur (master_holiday) & PIC customer (crm_contact via account_id). Mencegah rebound trip. Standalone dari shipment_tracking (F12) — trip tagih sering tanpa SJ.';

-- ── Menu RBAC (feature) ──
-- Sort 305: tepat setelah 'shipments' (300, lihat 044_rbac.sql) di section
-- Operations — pembacanya sama (tim Kirim-Tagih & Admin Shipping).
INSERT INTO feature (key, name, section, path, sort) VALUES
  ('pickup-plan', 'Jadwal Kirim-Tagih', 'Operations', '/pickup-plan', 305)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, section = EXCLUDED.section, path = EXCLUDED.path, sort = EXCLUDED.sort;

INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'pickup-plan', true, true, true, true, true FROM access_group g WHERE g.key = 'administrator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'pickup-plan', true, true, true, true, false FROM access_group g WHERE g.key = 'operator' ON CONFLICT DO NOTHING;
INSERT INTO access_permission (group_id, feature_key, active, can_view, can_create, can_edit, can_delete)
SELECT g.id, 'pickup-plan', true, true, false, false, false FROM access_group g WHERE g.key = 'viewer' ON CONFLICT DO NOTHING;
