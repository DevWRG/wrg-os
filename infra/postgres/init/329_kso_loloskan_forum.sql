-- 329 — F170 Komite KSO: usulan BELUM LENGKAP boleh diloloskan ke agenda forum (issue #2383).
--
-- Putusan Direktur 17 Nov 2026: "kelengkapan datanya bisa dilengkapi waktu forum". Draft (atau usulan DITAHAN) yang
-- isian #KSO-nya masih kurang tidak perlu menunggu AM melengkapi — Komite (tab Agenda), Sekretariat, atau Direksi
-- menekan "Loloskan ke agenda forum":
--   - status → DIAJUKAN → JALUR_FORUM tanpa syarat kelengkapan kso.ajukan (volume, harga, tenor, pendukung, alasan
--     strategis); nomor KSO terbit; gerbang & zona dihitung bila datanya ada, zona minimal Forum (yang memutus forum);
--   - kso.susun_agenda mendahulukan usulan yang diloloskan di Agenda A dan tidak menahannya karena bukti volume
--     belum diverifikasi (aturan 285). Batas agenda_a_maks per forum tetap berlaku.
-- Di forum, data yang masih kurang ditangani alur lama: Komite memilih DITAHAN + data kurang, AM melengkapi
-- (lengkapi_draft terbuka lagi di DITAHAN), lalu diajukan / diloloskan lagi.

alter table kso.rencana_kso
  add column if not exists diloloskan_at     timestamptz,
  add column if not exists diloloskan_oleh   text,
  add column if not exists diloloskan_alasan text;
comment on column kso.rencana_kso.diloloskan_at is '329: diloloskan ke agenda forum walau isian belum lengkap (putusan Direktur 17 Nov 2026).';

create or replace function kso.loloskan_ke_forum(p_id bigint, p_alasan text, p_oleh text)
returns text language plpgsql as $$
declare r kso.rencana_kso; v_level int; v_alasan_zona text;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.status not in ('DRAFT','DITAHAN') then raise exception 'TIDAK_BISA_DILOLOSKAN: status %', r.status; end if;

  -- gerbang & zona sebisanya: data yang kurang membuat gerbang "belum" / zona naik, tidak menggagalkan
  begin
    perform kso.hitung_gerbang(p_id);
    select t.level, t.alasan into v_level, v_alasan_zona from kso.tentukan_level(p_id) t;
  exception when others then
    v_level := null; v_alasan_zona := null;
  end;

  update kso.rencana_kso
     set diajukan_at = now(),
         nomor = coalesce(nomor, 'KSO-' || to_char(kso.hari_ini(),'YYYY') || '-' || lpad(id::text,4,'0')),
         diloloskan_at = now(), diloloskan_oleh = p_oleh,
         diloloskan_alasan = nullif(btrim(coalesce(p_alasan, '')), '')
   where id = p_id;
  perform kso.ubah_status(p_id, 'DIAJUKAN', p_oleh);
  update kso.rencana_kso
     set zona = kso.zona_level(greatest(coalesce(v_level, 3), 2)), jalur = 'FORUM',
         alasan_forum = 'Diloloskan ke forum walau isian belum lengkap'
                        || coalesce(' — ' || nullif(btrim(coalesce(p_alasan, '')), ''), '')
                        || coalesce(' · ' || v_alasan_zona, '')
   where id = p_id;
  perform kso.ubah_status(p_id, 'JALUR_FORUM', p_oleh);
  return (select nomor from kso.rencana_kso where id = p_id);
end $$;

create or replace function kso.app_loloskan_ke_forum(p_id bigint, p_alasan text default null)
returns text language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('komite', 'sekretaris', 'direksi');
  if length(coalesce(p_alasan, '')) > 500 then raise exception 'ALASAN_TERLALU_PANJANG'; end if;
  return kso.loloskan_ke_forum(p_id, p_alasan, kso.peran_saya() || ':' || coalesce(kso.uid_saya(), ''));
end $$;

revoke execute on function kso.loloskan_ke_forum(bigint, text, text) from public;
revoke execute on function kso.app_loloskan_ke_forum(bigint, text) from public;
grant execute on function kso.app_loloskan_ke_forum(bigint, text) to wrg_app;

-- Susun agenda: usulan yang diloloskan didahulukan & tidak tertahan verifikasi volume (285). Isi lain = 285 apa adanya.
create or replace function kso.susun_agenda(p_tanggal date, p_batas timestamp with time zone default null::timestamp with time zone)
returns bigint language plpgsql as $function$
declare v_forum bigint; v_prev timestamptz; v_batas timestamptz; v_n int := 0; x record;
begin
  if extract(isodow from p_tanggal) not in (2,4) then raise exception 'FORUM_HANYA_SELASA_KAMIS: %', p_tanggal; end if;
  v_batas := coalesce(p_batas, kso.jam_wib(p_tanggal, '14:00'));
  select max(diterbitkan_at) into v_prev from kso.forum where tanggal < p_tanggal;
  insert into kso.forum (tanggal) values (p_tanggal) returning id into v_forum;

  for x in select r.id from kso.rencana_kso r
            where r.status = 'JALUR_FORUM'
              and (select max(s.at) from kso.riwayat_status s where s.rencana_id = r.id and s.ke = 'JALUR_FORUM') <= v_batas
              -- 285: bukti tertulis belum diperiksa Sekretaris → ditahan sampai diverifikasi
              -- 329: kecuali diloloskan ke forum (putusan Direktur: kelengkapan dilengkapi di forum)
              and (r.diloloskan_at is not null
                   or not (r.zona in ('forum','direktur') and r.volume_sumber_label = 'data' and r.volume_terverifikasi is null))
            order by (r.diloloskan_at is not null) desc,
                     exists (select 1 from kso.riwayat_status s where s.rencana_id = r.id and s.dari = 'DITAHAN') desc,
                     (select a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0) from kso.alat a where a.kode = r.alat_kode) desc,
                     r.diajukan_at asc
            limit kso.param('agenda_a_maks')::int
  loop
    v_n := v_n + 1;
    insert into kso.agenda_item values (v_forum, x.id, 'A', v_n);
    perform kso.ubah_status(x.id, 'DIAGENDAKAN', 'sekretaris_otomatis');
  end loop;

  -- Agenda B: semua putusan jalur cepat sejak agenda sebelumnya diterbitkan — tidak ada yang tercecer
  insert into kso.agenda_item (forum_id, rencana_id, jenis, urut)
  select v_forum, s.rencana_id, 'B', 100 + row_number() over (order by s.at)
    from kso.riwayat_status s
   where s.ke in ('DIPUTUS_AM','DIPUTUS_HOD','DITOLAK_HOD')
     and s.at > coalesce(v_prev, '-infinity'::timestamptz) and s.at <= clock_timestamp()
  on conflict do nothing;

  if v_n = 0 then update kso.forum set mode = 'portofolio' where id = v_forum; end if;  -- forum tidak pernah batal
  return v_forum;
end $function$;
