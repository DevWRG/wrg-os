-- 280: F170 Komite KSO — Pipeline terkunci di bawah batas bawah mandat (Pedoman Komite KSO Forum v01:
-- "mandat otomatis ... pipeline terkunci di bawah batas bawah"). Keputusan user 6 Nov 2026: deal Pipeline
-- ditautkan OTOMATIS ke usulan KSO per faskes + alat (tanpa input AM).
--
-- public.kso_mandat_untuk_deal(account_id, teks produk/merek) → mandat aktif PALING KETAT (batas bawah tertinggi)
-- untuk faskes itu dengan alat yang cocok:
--   * usulan berstatus Diputus AM / Diputus HOD / Mandat terbit / Penawaran terbit, mandat belum kedaluwarsa;
--   * faskes = kso.rencana_kso.faskes_id (= account_id OS);
--   * alat cocok bila teks deal memuat kode alat sebagai KATA UTUH (Z3 ≠ Z30; kode tanpa angka = merek, tak dipakai),
--     nama alat utuh, atau nama alat tanpa kata pertama (merek) — mis. "MAGLUMI X3" ↔ alat "Snibe Maglumi X3";
--     "EXC 200" = "EXC200".
-- Penolakan harga dikerjakan API deal (apps/api/src/repo/deal.ts), BUKAN trigger: importer/job massal tak boleh
-- gagal satu batch karena satu baris. SECURITY DEFINER karena tabel kso.* ber-RLS per peran Komite.

create or replace function public.kso_mandat_untuk_deal(p_account bigint, p_teks text)
returns table (rencana_id bigint, nomor text, lantai numeric, target numeric, pembuka numeric, berlaku_sampai date)
language sql stable security definer set search_path = pg_catalog, public as $$
  select r.id, r.nomor, m.harga_lantai, m.harga_target, m.harga_pembuka, m.berlaku_sampai
    from kso.rencana_kso r
    join kso.mandat m on m.rencana_id = r.id
    join kso.alat a on a.kode = r.alat_kode
   where p_account is not null and coalesce(btrim(p_teks), '') <> ''
     and r.faskes_id = p_account::text
     and r.status in ('DIPUTUS_AM','DIPUTUS_HOD','MANDAT_TERBIT','PENAWARAN_TERBIT')
     and m.berlaku_sampai >= kso.hari_ini()
     -- kode (HANYA bila memuat angka — kode tanpa angka seperti SNIBE = merek, bukan model) / nama / nama tanpa
     -- merek — semuanya frasa utuh (\m … \M), non-alfanumerik di-escape; spasi huruf→angka dirapatkan
     -- di kedua sisi ("EXC 200" = "EXC200")
     and exists (select 1 from unnest(array[case when a.kode ~ '[0-9]' then a.kode end, a.nama,
                                            case when a.nama ~ '\s' then regexp_replace(a.nama, '^\S+\s+', '') end]) k(frasa)
                  where coalesce(btrim(k.frasa), '') <> ''
                    and regexp_replace(upper(p_teks), '([A-Z])\s+([0-9])', '\1\2', 'g')
                        ~ ('\m' || regexp_replace(regexp_replace(upper(btrim(k.frasa)), '([A-Z])\s+([0-9])', '\1\2', 'g'),
                                                   '([^A-Z0-9])', '\\\1', 'g') || '\M'))
   order by m.harga_lantai desc
   limit 1
$$;

comment on function public.kso_mandat_untuk_deal(bigint, text) is
  'F170 (280): mandat KSO aktif paling ketat untuk faskes + alat sebuah deal Pipeline — dasar penguncian harga di bawah batas bawah.';

revoke execute on function public.kso_mandat_untuk_deal(bigint, text) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'wrg_app') then
    grant execute on function public.kso_mandat_untuk_deal(bigint, text) to wrg_app;
  end if;
  if exists (select 1 from pg_roles where rolname = 'wrg_readonly') then
    grant execute on function public.kso_mandat_untuk_deal(bigint, text) to wrg_readonly;
  end if;
end $$;
