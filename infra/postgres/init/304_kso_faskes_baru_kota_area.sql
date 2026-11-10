-- 304 — F170 Komite KSO: kota faskes BARU tidak lagi ditanyakan ke AM — default = AREA AM.
--
-- Keputusan product owner (10 Nov 2026): "untuk kota bisa di cek berdasarkan kota customer ataupun area AM".
--   * faskes master (cermin crm_account): kota/cabang sudah dari master customer (area_customer, 228) — tak berubah;
--   * faskes SEMENTARA (303, id BARU-<n>): tanpa label KOTA → kota = kso.am.cabang pengusul (area AM; sumber yang
--     sama dengan faskes.cabang di 303 = master_user.cabang lewat segarkan_referensi). Kota dari area ditandai
--     kota_dari_area = true supaya kota yang LEBIH PASTI (PDF Simulator, atau label KOTA bila AM tetap menulisnya)
--     boleh menggantinya; kota yang ditulis/dari PDF tetap tak pernah ditimpa.
-- 303 sudah terpasang di dev → perubahan fungsi di berkas baru ini (CREATE OR REPLACE, tanda tangan sama, GRANT 303
-- tetap berlaku).

set search_path = kso, public;

alter table kso.faskes add column if not exists kota_dari_area boolean not null default false;
comment on column kso.faskes.kota_dari_area is
  '304: kota faskes sementara masih default area AM (kso.am.cabang) — boleh diganti kota dari PDF Simulator / label KOTA.';

-- bot: buat (atau pakai ulang) faskes sementara; kota kosong → area AM
create or replace function kso.app_bot_buat_faskes_baru(p_am text, p_nama text, p_kota text default null)
returns text language plpgsql security definer set search_path = kso, public as $$
declare v_nama text := regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g');
        v_kota text := nullif(regexp_replace(btrim(coalesce(p_kota, '')), '\s+', ' ', 'g'), '');
        v_cabang text; v_id text;
begin
  perform kso.wajib_peran('bot_wa');
  if length(v_nama) < 3 or length(v_nama) > 150 then raise exception 'FASKES_NAMA_TIDAK_SAH: %', v_nama; end if;
  select cabang into v_cabang from kso.am where id = p_am;
  if not found then raise exception 'AM_TIDAK_ADA: %', p_am; end if;
  -- nama sama (tanpa beda huruf besar/spasi) yang belum ditautkan = faskes yang sama: tidak digandakan
  select id into v_id from kso.faskes where baru and ditautkan_ke is null and upper(nama) = upper(v_nama)
   order by dibuat_at limit 1;
  if v_id is not null then
    -- kota tertulis mengganti kota kosong / default area; tanpa kota tertulis, kota kosong diisi area AM ini
    update kso.faskes set
      kota           = case when v_kota is not null and (kota is null or kota_dari_area) then v_kota
                            else coalesce(kota, v_cabang) end,
      kota_dari_area = case when v_kota is not null and (kota is null or kota_dari_area) then false
                            when kota is null then v_cabang is not null
                            else kota_dari_area end
     where id = v_id;
    return v_id;
  end if;
  v_id := 'BARU-' || nextval('kso.faskes_baru_seq');
  insert into kso.faskes (id, nama, cabang, grup, piutang_hari, piutang_nilai, tagihan_bulanan, baru, kota, kota_dari_area,
                          dibuat_oleh_am, dibuat_at)
  values (v_id, v_nama, v_cabang, null, 0, 0, 0, true, coalesce(v_kota, v_cabang), v_kota is null and v_cabang is not null,
          p_am, now());
  return v_id;
end $$;

-- bot: kota faskes sementara yang masih kosong ATAU masih default area AM (PDF Simulator / label KOTA). Kota yang
-- ditulis/dari PDF tak pernah ditimpa.
create or replace function kso.app_bot_isi_kota_faskes(p_am text, p_faskes text, p_kota text)
returns boolean language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('bot_wa');
  update kso.faskes f set kota = regexp_replace(btrim(p_kota), '\s+', ' ', 'g'), kota_dari_area = false
   where f.id = p_faskes and f.baru and (f.kota is null or f.kota_dari_area) and nullif(btrim(coalesce(p_kota, '')), '') is not null
     and (f.dibuat_oleh_am = p_am or exists (select 1 from kso.rencana_kso r where r.faskes_id = f.id and r.am_id = p_am));
  return found;
end $$;

-- isi baris lama: faskes sementara tanpa kota → area AM pembuatnya
update kso.faskes f set kota = a.cabang, kota_dari_area = true
  from kso.am a
 where f.baru and f.kota is null and a.id = f.dibuat_oleh_am and a.cabang is not null;
