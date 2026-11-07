-- 190 — F11 Approval Engine: tahap 1 & 2 diarahkan per request, tahap 4 = Ika (#1071).
--
-- KEPUTUSAN PEMILIK FITUR (2026-09-30), menutup bagian 1 #1071:
--   Tahap 1 HoD Sales      → IKUT WILAYAH PENGAJU: east → rocky, west → yogi
--   Tahap 2 HoD Bisnis     → IKUT KATEGORI BARANG: IVD → mufid, Medical → arman
--   Tahap 3 HoD After Sales→ muhid (dikonfirmasi, tidak diubah)
--   Tahap 4 HoD Supply Chain → ika (HoD Finance & SC resmi, punya akun app_user)
--
-- Kenapa bukan cukup isi hod_key: untuk tahap 1 & 2 jawabannya BUKAN satu
-- orang. Satu slot hod_key tak bisa menampung "tergantung". Jadi slot mendapat
-- `routing` + `hod_key_map`, dan request membawa atribut `wilayah` / `kategori`
-- yang dipakai memilih orangnya SAAT REQUEST DIBUAT (disnapshot ke
-- approval_step.hod_key, pola yang sama dengan hod_key tetap).
--
--   routing = 'tetap'    → pakai hod_key (perilaku lama, default semua baris)
--   routing = 'wilayah'  → hod_key_map ->> approval_request.wilayah
--   routing = 'kategori' → hod_key_map ->> approval_request.kategori
--
-- Kosakata atribut sengaja kecil & dibatasi CHECK:
--   wilayah  ∈ {east, west}      — selaras HoD Sales East/West (hod-resolver.ts)
--   kategori ∈ {IVD, Medical}    — selaras deal.product_category & HoD Business
-- NULL sah: request lama & pemanggil yang belum mengisi (mis. F19 forecast).
-- Tahap yang butuh atribut tapi atributnya kosong TIDAK error saat dibuat;
-- notifikasinya gagal dengan sebab 'atribut-kosong' yang menyebut atribut mana.
--
-- Additive + idempoten. Tanpa BEGIN/COMMIT (runner yang mengelola transaksi).

ALTER TABLE approval_chain_config ADD COLUMN IF NOT EXISTS routing text NOT NULL DEFAULT 'tetap';
ALTER TABLE approval_chain_config ADD COLUMN IF NOT EXISTS hod_key_map jsonb;

ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS wilayah text;
ALTER TABLE approval_request ADD COLUMN IF NOT EXISTS kategori text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_chain_config_routing_check') THEN
    ALTER TABLE approval_chain_config
      ADD CONSTRAINT approval_chain_config_routing_check CHECK (routing IN ('tetap', 'wilayah', 'kategori'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_wilayah_check') THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_wilayah_check CHECK (wilayah IS NULL OR wilayah IN ('east', 'west'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approval_request_kategori_check') THEN
    ALTER TABLE approval_request
      ADD CONSTRAINT approval_request_kategori_check CHECK (kategori IS NULL OR kategori IN ('IVD', 'Medical'));
  END IF;
END $$;

-- Tahap 1 & 2: routing + peta. hod_key lama dibiarkan (diabaikan selama
-- routing <> 'tetap'), supaya kalau suatu hari dikembalikan ke 'tetap' nilai
-- sebelumnya tidak hilang.
UPDATE approval_chain_config SET
  routing = 'wilayah',
  hod_key_map = '{"east": "rocky", "west": "yogi"}'::jsonb,
  catatan = 'Ikut wilayah pengaju: East → Rocky, West → Yogi (keputusan 2026-09-30, #1071). Request wajib membawa wilayah.',
  updated_at = now()
WHERE urutan = 1;

UPDATE approval_chain_config SET
  routing = 'kategori',
  hod_key_map = '{"IVD": "mufid", "Medical": "arman"}'::jsonb,
  catatan = 'Ikut kategori barang: IVD → Mufid, Medical → Arman (keputusan 2026-09-30, #1071). Request wajib membawa kategori.',
  updated_at = now()
WHERE urutan = 2;

-- Tahap 4: Ika. wa_number_override dikosongkan — override menang atas hod_key
-- (resolveStepTarget), jadi override lama (kandidat Pita) akan diam-diam
-- membelokkan keputusan ini.
UPDATE approval_chain_config SET
  hod_key = 'ika',
  wa_number_override = NULL,
  catatan = 'Ika — HoD Finance & SC (keputusan 2026-09-30, #1071).',
  updated_at = now()
WHERE urutan = 4;

UPDATE approval_chain_config SET
  catatan = 'Muhid — dikonfirmasi pemilik fitur 2026-09-30 (#1071).',
  updated_at = now()
WHERE urutan = 3 AND hod_key = 'muhid';
