-- 276: kso_jenis_kanonik / kso_jenis_alias_key — rujukan bernama skema lengkap.
--
-- Uji pulih cadangan harian (4 Nov 2026) menemukan: pg_restore mengosongkan search_path,
-- dan kso_jenis_kanonik (112) merujuk kso_jenis_alat_alias + kso_jenis_alias_key TANPA
-- skema → "relation kso_jenis_alat_alias does not exist" saat
-- REFRESH MATERIALIZED VIEW public.kso_asset_produktivitas_mv. Data tabel tetap pulih, tetapi
-- MV itu kosong di salinan hasil pulih sampai di-refresh manual.
--
-- Diperbaiki dengan nama skema di badan fungsi, BUKAN `SET search_path` pada fungsi: fungsi
-- SQL ber-SET tidak di-inline planner, padahal fungsi ini dipakai di banyak view/MV KSO.
-- Badan & hasil identik dengan 112 — hanya rujukannya yang dilengkapi. Additive, idempoten.

CREATE OR REPLACE FUNCTION public.kso_jenis_alias_key(p_type_alat text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(upper(regexp_replace(COALESCE(p_type_alat,''), '[^a-zA-Z0-9]', '', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION public.kso_jenis_kanonik(p_type_alat text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT a.canonical FROM public.kso_jenis_alat_alias a
      WHERE a.alias_key = public.kso_jenis_alias_key(p_type_alat)),
    NULLIF(btrim(COALESCE(p_type_alat,'')), '')
  )
$$;
