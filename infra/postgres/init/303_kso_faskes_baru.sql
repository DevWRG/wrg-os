-- 303 — F170 Komite KSO: FASKES BARU (calon customer) dari #KSO WhatsApp.
--
-- Keputusan product owner (10 Nov 2026): "nama faskes tidak harus yang ada di eksisting, karena bisa juga untuk
-- customer/faskes baru". Sampai 302 intake #KSO hanya memakai faskes master (kso.faskes = cermin crm_account yang
-- disegarkan malam oleh kso.segarkan_referensi) dan menolak nama yang tak ketemu. Sejak 303:
--   * cocok pasti ke satu faskes master            → dipakai (seperti dulu);
--   * mirip tapi tidak pasti (salah ketik / ambigu) → isian disimpan di kso.intake_tertunda, AM memilih
--                                                     "#KSO FASKES 1/2/3" atau "#KSO FASKES BARU";
--   * tidak ada yang mirip                          → faskes SEMENTARA dibuat langsung (id 'BARU-<n>', baru = true).
-- Faskes sementara: cabang = cabang AM pengusul, piutang/tagihan 0 (gerbang 5 hijau "Faskes baru — belum ada
-- tagihan", hitung_gerbang 266), kota dari label KOTA: atau dari PDF Simulator. Sekretariat/Komite menautkannya ke
-- akun master begitu customer itu ada di Accurate/CRM (kso.app_tautkan_faskes) — semua usulan pindah ke akun master.
--
-- kso.segarkan_referensi (228) TIDAK diubah: ia hanya meng-upsert id = crm_account.account_id (angka) dan tak pernah
-- menghapus, jadi baris 'BARU-<n>' tak tersentuh (diuji scripts/qa/kso-komite/919_uji_faskes_baru.sql). Pengaman
-- tambahan: CHECK id 'BARU-%' ⇔ baru, supaya id angka dari refresh tak pernah bisa menimpa/menjadi baris sementara.
-- Konsumen faskes_id lain (231 bulan-6, 280 mandat untuk deal) membandingkan teks account_id = faskes_id → baris
-- sementara tidak cocok ke akun mana pun sampai ditautkan (tanpa galat cast).
--
-- Akses (pola 227): tabel baca saja untuk wrg_app; tulis hanya lewat fungsi security definer kso.app_bot_* (peran
-- bot_wa) dan kso.app_tautkan_faskes (peran komite/sekretaris).

set search_path = kso, public;

-- ---------- kolom faskes ----------
alter table kso.faskes
  add column if not exists baru            boolean not null default false,
  add column if not exists kota            text,
  add column if not exists dibuat_oleh_am  text references kso.am(id),
  add column if not exists dibuat_at       timestamptz,
  add column if not exists ditautkan_ke    text references kso.faskes(id),
  add column if not exists ditautkan_at    timestamptz,
  add column if not exists ditautkan_oleh  text;
alter table kso.faskes drop constraint if exists faskes_baru_id_ck;
alter table kso.faskes add constraint faskes_baru_id_ck check (baru = (id like 'BARU-%'));
alter table kso.faskes drop constraint if exists faskes_tautan_ck;
alter table kso.faskes add constraint faskes_tautan_ck check (ditautkan_ke is null or (baru and ditautkan_ke <> id));
create index if not exists faskes_baru_nama_idx on kso.faskes (upper(nama)) where baru and ditautkan_ke is null;
comment on column kso.faskes.baru is '303: faskes SEMENTARA (calon customer) dibuat dari #KSO — id BARU-<n>. Tidak disentuh segarkan_referensi.';
comment on column kso.faskes.kota is '303: kota faskes sementara (label KOTA: di #KSO atau dari PDF Simulator).';
comment on column kso.faskes.ditautkan_ke is '303: akun master pengganti faskes sementara (diisi Sekretariat/Komite lewat app_tautkan_faskes).';

create sequence if not exists kso.faskes_baru_seq;
revoke all on sequence kso.faskes_baru_seq from public;
do $$ declare r text; begin
  foreach r in array array['wrg_app','wrg_readonly','wrg_demo_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on sequence kso.faskes_baru_seq from %I', r);
    end if;
  end loop;
end $$;

-- ---------- isian tertunda: alat DAN faskes bisa sama-sama menunggu ----------
alter table kso.intake_tertunda
  add column if not exists alat_kode     text references kso.alat(kode),     -- alat sudah pasti (faskes masih ditanya)
  add column if not exists faskes_teks   text,                               -- nama faskes yang ditulis AM
  add column if not exists faskes_saran  jsonb not null default '[]',        -- [{id, nama, cabang, baru}] urut nomor balasan
  add column if not exists kota          text,                               -- label KOTA: (untuk faskes baru)
  add column if not exists lampiran_wa   text,                               -- PDF yang dikirim BERSAMA pesan #KSO aslinya
  add column if not exists lampiran_path text;
comment on table kso.intake_tertunda is
  '302/303: isian #KSO yang alat dan/atau faskesnya belum pasti. faskes_id null = faskes ditanya; alat_kode null = alat ditanya. Ditutup saat draft jadi.';

-- ---------- bot: buat (atau pakai ulang) faskes sementara ----------
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
    update kso.faskes set kota = coalesce(kota, v_kota) where id = v_id;
    return v_id;
  end if;
  v_id := 'BARU-' || nextval('kso.faskes_baru_seq');
  insert into kso.faskes (id, nama, cabang, grup, piutang_hari, piutang_nilai, tagihan_bulanan, baru, kota, dibuat_oleh_am, dibuat_at)
  values (v_id, v_nama, v_cabang, null, 0, 0, 0, true, v_kota, p_am, now());
  return v_id;
end $$;

-- bot: kota faskes sementara yang masih kosong (label KOTA: susulan / PDF Simulator). Tak pernah menimpa.
create or replace function kso.app_bot_isi_kota_faskes(p_am text, p_faskes text, p_kota text)
returns boolean language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('bot_wa');
  update kso.faskes f set kota = regexp_replace(btrim(p_kota), '\s+', ' ', 'g')
   where f.id = p_faskes and f.baru and f.kota is null and nullif(btrim(coalesce(p_kota, '')), '') is not null
     and (f.dibuat_oleh_am = p_am or exists (select 1 from kso.rencana_kso r where r.faskes_id = f.id and r.am_id = p_am));
  return found;
end $$;

-- bot: simpan isian usulan baru yang alat dan/atau faskesnya belum pasti (satu pertanyaan terbuka per AM)
create or replace function kso.app_bot_tertunda_simpan(
  p_am text, p_isian jsonb, p_wa text, p_faskes text, p_faskes_teks text, p_faskes_saran jsonb, p_kota text,
  p_alat_kode text, p_alat_teks text, p_alat_saran jsonb, p_lampiran_wa text default null, p_lampiran_path text default null)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare v_id bigint;
begin
  perform kso.wajib_peran('bot_wa');
  if p_faskes is null and nullif(btrim(coalesce(p_faskes_teks, '')), '') is null then
    raise exception 'TERTUNDA_TANPA_FASKES';
  end if;
  update kso.intake_tertunda set selesai_at = now()
   where am_id = p_am and selesai_at is null and rencana_id is null;
  insert into kso.intake_tertunda (am_id, rencana_id, faskes_id, isian, alat_teks, saran, wa_message_id,
                                   alat_kode, faskes_teks, faskes_saran, kota, lampiran_wa, lampiran_path)
  values (p_am, null, p_faskes, coalesce(p_isian, '{}'), p_alat_teks, coalesce(p_alat_saran, '[]'), p_wa,
          p_alat_kode, p_faskes_teks, coalesce(p_faskes_saran, '[]'), nullif(btrim(coalesce(p_kota, '')), ''),
          p_lampiran_wa, p_lampiran_path)
  returning id into v_id;
  return v_id;
end $$;

-- bot: isi bagian yang dijawab AM — kunci yang ADA di p_ubah ditulis apa adanya (null = dibuka lagi): faskes_id,
-- alat_kode, alat_teks+saran, faskes_teks+faskes_saran; kota hanya mengisi. Hanya baris terbuka milik AM itu.
create or replace function kso.app_bot_tertunda_isi(p_id bigint, p_am text, p_ubah jsonb)
returns void language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('bot_wa');
  update kso.intake_tertunda set
    faskes_id    = case when p_ubah ? 'faskes_id' then p_ubah->>'faskes_id' else faskes_id end,
    alat_kode    = case when p_ubah ? 'alat_kode' then p_ubah->>'alat_kode' else alat_kode end,
    kota         = coalesce(nullif(btrim(coalesce(p_ubah->>'kota', '')), ''), kota),
    alat_teks    = case when p_ubah ? 'saran' then p_ubah->>'alat_teks' else alat_teks end,
    saran        = case when p_ubah ? 'saran' then coalesce(p_ubah->'saran', '[]') else saran end,
    faskes_teks  = case when p_ubah ? 'faskes_saran' then p_ubah->>'faskes_teks' else faskes_teks end,
    faskes_saran = case when p_ubah ? 'faskes_saran' then coalesce(p_ubah->'faskes_saran', '[]') else faskes_saran end
   where id = p_id and am_id = p_am and selesai_at is null;
  if not found then raise exception 'TERTUNDA_TIDAK_ADA: %', p_id; end if;
end $$;

-- ---------- Sekretariat / Komite: tautkan faskes sementara ke akun master ----------
-- Semua usulan (dan isian tertunda) yang memakai faskes sementara pindah ke akun master; baris sementara disimpan
-- sebagai jejak (ditautkan_ke). Gerbang draft yang masih terbuka dihitung ulang (piutang & cabang master berlaku);
-- usulan yang sudah diajukan tidak dihitung ulang — putusannya tetap berdasar data saat diajukan.
create or replace function kso.app_tautkan_faskes(p_rencana bigint, p_master text)
returns int language plpgsql security definer set search_path = kso, public as $$
declare v_baru text; v_n int; v_id bigint;
begin
  perform kso.wajib_peran('komite', 'sekretaris');
  select faskes_id into v_baru from kso.rencana_kso where id = p_rencana;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_rencana; end if;
  if not exists (select 1 from kso.faskes where id = v_baru and baru and ditautkan_ke is null) then
    raise exception 'FASKES_BUKAN_BARU: %', v_baru;
  end if;
  if not exists (select 1 from kso.faskes where id = p_master and not baru) then
    raise exception 'AKUN_MASTER_TIDAK_ADA: %', p_master;
  end if;
  update kso.rencana_kso set faskes_id = p_master, diubah_at = now() where faskes_id = v_baru;
  get diagnostics v_n = row_count;
  update kso.intake_tertunda set faskes_id = p_master where faskes_id = v_baru;
  update kso.faskes set ditautkan_ke = p_master, ditautkan_at = now(), ditautkan_oleh = kso.uid_saya() where id = v_baru;
  for v_id in select id from kso.rencana_kso where faskes_id = p_master and status in ('DRAFT','DITAHAN') loop
    perform kso.hitung_gerbang(v_id);
  end loop;
  return v_n;
end $$;

revoke execute on function kso.app_bot_buat_faskes_baru(text, text, text),
                           kso.app_bot_isi_kota_faskes(text, text, text),
                           kso.app_bot_tertunda_simpan(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text),
                           kso.app_bot_tertunda_isi(bigint, text, jsonb),
                           kso.app_tautkan_faskes(bigint, text) from public;
grant execute on function kso.app_bot_buat_faskes_baru(text, text, text),
                          kso.app_bot_isi_kota_faskes(text, text, text),
                          kso.app_bot_tertunda_simpan(text, jsonb, text, text, text, jsonb, text, text, text, jsonb, text, text),
                          kso.app_bot_tertunda_isi(bigint, text, jsonb),
                          kso.app_tautkan_faskes(bigint, text) to wrg_app;
