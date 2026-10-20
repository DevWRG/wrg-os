-- 241 — Umur piutang dihitung saat DIBACA, bukan dicap saat ditulis. Idempoten.
--
-- Masalah (temuan sesi prioritas Direktur 20 Okt 2026): `ar_aging_mv.bucket` & `days_overdue`
-- dicap oleh `upsertAging` (repo/ar.ts) memakai tanggal HARI ITU. Sync harian cuma menulis ulang
-- faktur bertanggal 7 hari terakhir, jadi faktur lama tak pernah dicap ulang. Backfill 6 Sep
-- (#1192) menulis semua baris sekali → 10.353 baris 31-60/61-90/90+ beku di 6 Sep. Di prod
-- 21 Okt: 90+ tampil Rp 2,78 M (131 faktur), dihitung ulang Rp 4,83 M (307 faktur) — tanpa galat.
--
-- Perbaikan: tabel jadi `ar_aging_base` (data mentah dari Accurate, satu-satunya penulis =
-- upsertAging), dan `ar_aging_mv` jadi VIEW dengan nama & urutan kolom yang SAMA — ke-71
-- pembaca di 11 berkas repo tak berubah. days_overdue/bucket/is_anomaly dihitung dari
-- due_date vs tanggal WIB hari ini; kolom tersimpan di base diabaikan (tinggal jejak ingest).
--
-- Batas bucket identik bucketOf() di repo/ar.ts: hari ≤ 0 current, ≤30, ≤60, ≤90, sisanya 90+.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND c.relname = 'ar_aging_mv' AND c.relkind = 'r') THEN
    ALTER TABLE public.ar_aging_mv RENAME TO ar_aging_base;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.ar_aging_mv AS
SELECT b.customer_id,
       b.customer_name,
       b.invoice_no,
       b.due_date,
       b.amount,
       GREATEST(0, h.hari)::int AS days_overdue,
       (CASE WHEN h.hari <= 0 THEN 'current'
             WHEN h.hari <= 30 THEN '1-30'
             WHEN h.hari <= 60 THEN '31-60'
             WHEN h.hari <= 90 THEN '61-90'
             ELSE '90+' END)::varchar(10) AS bucket,
       (h.hari > 90) AS is_anomaly,
       b.refreshed_at
  FROM public.ar_aging_base b
  CROSS JOIN LATERAL (SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date - b.due_date) AS hari) h;

COMMENT ON VIEW public.ar_aging_mv IS
  'Umur piutang hidup (241): bucket/days_overdue dihitung saat dibaca dari due_date vs hari ini WIB. Tulis ke ar_aging_base.';

-- Default privileges 039 hanya berlaku untuk role yang menjalankannya — grant eksplisit.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_app') THEN
    GRANT SELECT ON public.ar_aging_mv TO wrg_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wrg_readonly') THEN
    GRANT SELECT ON public.ar_aging_mv TO wrg_readonly;
  END IF;
END $$;
