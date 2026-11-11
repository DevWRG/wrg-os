-- 245 — F63 Weekly Briefing Direktur: satu baris per minggu ISO TARGET.
--
-- Tiap Senin 07:00 job membaca rekap + resume (monitor_digest) minggu ISO yang
-- BARU TUTUP (Senin–Minggu lalu), menyusun briefing untuk minggu yang baru mulai,
-- menyimpannya di sini, lalu mengirim WA ke Direktur berupa LINK ke tab
-- "Briefing Mingguan" di /briefings (isi briefing tidak ikut di WA).
--
-- Sengaja TABEL SENDIRI, bukan monitor_digest kind='briefing' (briefing weekend
-- Sabtu/Minggu, weekendbriefing.ts): grain-nya per minggu ISO dan generate ulang
-- minggu yang sama harus MENIMPA, bukan menumpuk.
--
--   iso_year/iso_week  minggu yang BRIEFING-nya dibuat untuk (minggu berjalan Senin itu)
--   dasar_dari/_sampai rentang rekap/resume yang dibaca (minggu lalu), tanggal WIB
--   n_rekap/n_resume   jumlah dokumen digest yang dibaca (jejak audit: 0 = tak dibuat)
--   narasi_ok          false = LLM gagal/dry-run → content cuma catatan, bukan briefing
--   wa_*               jejak pengiriman link (NULL = belum/tidak dikirim)

CREATE TABLE IF NOT EXISTS briefing_mingguan (
  id            bigserial PRIMARY KEY,
  iso_year      int  NOT NULL,
  iso_week      int  NOT NULL,
  periode       text NOT NULL,
  dasar_dari    date NOT NULL,
  dasar_sampai  date NOT NULL,
  n_rekap       int  NOT NULL DEFAULT 0,
  n_resume      int  NOT NULL DEFAULT 0,
  content       text NOT NULL,
  narasi_ok     boolean NOT NULL DEFAULT false,
  model_used    text,
  wa_target     text,
  wa_sent_at    timestamptz,
  wa_error      text,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (iso_year, iso_week)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT, INSERT, UPDATE ON briefing_mingguan TO wrg_app;
    GRANT USAGE, SELECT ON SEQUENCE briefing_mingguan_id_seq TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON briefing_mingguan TO wrg_readonly;
  END IF;
END $$;
