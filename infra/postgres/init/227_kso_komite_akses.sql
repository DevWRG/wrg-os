-- 227 — F170 Komite KSO: hak akses per peran, versi WRG-OS (pengganti 005_akses_supabase.sql)
--
-- Paket rujukan memakai Supabase (auth.uid(), role anon/authenticated/service_role). WRG-OS
-- tidak memakai Supabase: API konek sebagai `wrg_app` (DML-only, migrasi 039) dan identitas
-- pengguna sudah diverifikasi API dari JWT (`sub` = master_user.id). Terjemahannya:
--   auth.uid()                → kso.uid_saya() = GUC transaksi `wrg.kso_user`, diisi API dengan
--                               set_config('wrg.kso_user', <master_user.id>, true) di awal transaksi
--   role authenticated        → wrg_app
--   role anon                 → tidak ada padanan; wrg_readonly/wrg_demo_app/PUBLIC tanpa hak sama sekali
--   service_role (job server) → DIHAPUS dari pagar peran. Job terjadwal (agenda 14.00, lewat batas HOD)
--                               diberi hak eksplisit di Tahap 5, bukan lewat celah "tanpa akun".
-- Model kepercayaan: siapa pun yang memegang koneksi wrg_app bisa mengisi GUC itu — sama dengan
-- x-service-token di API. Pagar sebenarnya = API hanya mengisi GUC dari JWT yang sah.
-- Logika selain itu (boleh_lihat, RLS, pembungkus app_*) identik dengan rujukan v1.0.1.
--
-- Diuji: scripts/qa/kso-komite/901_uji_akses_wrg.sql (20 uji, terjemahan 901_uji_akses.sql).

set search_path = kso, public;

alter default privileges in schema kso revoke execute on functions from public;

create table if not exists kso.pengguna (
  user_id   text primary key,   -- master_user.id (JWT sub)
  peran     text not null check (peran in ('am','hod','komite','sekretaris','direksi','admin_sales','teknik','bot_wa')),
  ref_id    text                -- am.id untuk AM, hod.id untuk HOD
);

create or replace function kso.uid_saya() returns text language sql stable
set search_path = kso, public as
$$ select nullif(current_setting('wrg.kso_user', true), '') $$;

create or replace function kso.peran_saya() returns text language sql stable security definer
set search_path = kso, public as
$$ select peran from kso.pengguna where user_id = kso.uid_saya() $$;
create or replace function kso.ref_saya() returns text language sql stable security definer
set search_path = kso, public as
$$ select ref_id from kso.pengguna where user_id = kso.uid_saya() $$;

-- boleh melihat satu rencana? — satu tempat untuk seluruh aturan baca
create or replace function kso.boleh_lihat(p_id bigint) returns boolean language sql stable security definer
set search_path = kso, public as $$
  select case kso.peran_saya()
    when 'am'  then exists (select 1 from kso.rencana_kso r where r.id = p_id and r.am_id = kso.ref_saya())
    when 'hod' then exists (select 1 from kso.hod_untuk(p_id) h where h.hod_id = kso.ref_saya())
    when 'teknik' then exists (select 1 from kso.rencana_kso r where r.id = p_id and r.status in ('PKS_TTD','TERPASANG'))
    when 'admin_sales' then exists (select 1 from kso.rencana_kso r where r.id = p_id
                                    and r.status in ('DIPUTUS_HOD','MANDAT_TERBIT','PENAWARAN_TERBIT','PKS_TTD','TERPASANG','KALAH'))
    else coalesce(kso.peran_saya() in ('komite','sekretaris','direksi','bot_wa'), false)
  end $$;

-- ---------- RLS: semua tabel ----------
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'kso' loop
    execute format('alter table kso.%I enable row level security', t);
  end loop;
end $$;

-- tabel rencana dan semua tabel anak: ikut boleh_lihat
drop policy if exists baca on kso.rencana_kso;
create policy baca on kso.rencana_kso for select to wrg_app using (kso.boleh_lihat(id));
do $$ declare t text; begin
  foreach t in array array['gerbang_hasil','pendapat_hod','mandat','rencana_klausul','rencana_pendukung','klaim_pembagian',
                           'usulan_komite_catatan','putusan_direksi_catatan','verifikasi_bulan6','riwayat_status','agenda_item'] loop
    execute format('drop policy if exists baca on kso.%I', t);
    execute format('create policy baca on kso.%I for select to wrg_app using (kso.boleh_lihat(rencana_id))', t);
  end loop;
end $$;

-- referensi tanpa data pribadi: semua akun yang login boleh membaca
do $$ declare t text; begin
  foreach t in array array['parameter','kategori','alat','cabang','cabang_teknisi','faskes','grup_mitra',
                           'klausul_khusus','hod','forum','transisi'] loop
    execute format('drop policy if exists baca on kso.%I', t);
    execute format('create policy baca on kso.%I for select to wrg_app using (kso.peran_saya() is not null)', t);
  end loop;
end $$;

-- data orang: AM hanya melihat barisnya sendiri (nomor WA AM lain tidak terbaca)
drop policy if exists baca on kso.am;
create policy baca on kso.am for select to wrg_app
  using (kso.peran_saya() is not null and (kso.peran_saya() <> 'am' or id = kso.ref_saya()));
drop policy if exists baca on kso.pengguna;
create policy baca on kso.pengguna for select to wrg_app
  using (user_id = kso.uid_saya() or kso.peran_saya() in ('sekretaris','direksi'));

-- view ikut hak akses pemanggil (Postgres 15+)
alter view kso.v_rencana   set (security_invoker = on);
alter view kso.v_antrean   set (security_invoker = on);
alter view kso.v_agenda    set (security_invoker = on);
alter view kso.v_kpi_am    set (security_invoker = on);
alter view kso.v_ringkasan set (security_invoker = on);

-- ---------- hak tabel: baca saja, tidak ada tulis langsung ----------
revoke all on all tables in schema kso from public;
revoke all on all sequences in schema kso from public;
do $$ declare r text; begin
  foreach r in array array['wrg_app','wrg_readonly','wrg_demo_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema kso from %I', r);
      execute format('revoke all on all sequences in schema kso from %I', r);
      execute format('revoke execute on all functions in schema kso from %I', r);
    end if;
  end loop;
end $$;
grant usage on schema kso to wrg_app;
grant select on all tables in schema kso to wrg_app;

-- ---------- hak fungsi: cabut semua, beri yang perlu ----------
revoke execute on all functions in schema kso from public;
grant execute on function kso.param(text), kso.rp(numeric), kso.hari_ini(), kso.jam_wib(date,time),
                          kso.hod_untuk(bigint), kso.uid_saya(), kso.peran_saya(), kso.ref_saya(), kso.boleh_lihat(bigint)
  to wrg_app;

-- ---------- pagar peran ----------
create or replace function kso.wajib_peran(variadic p_peran text[]) returns void
language plpgsql stable security definer set search_path = kso, public as $$
begin
  if kso.uid_saya() is null then
    raise exception 'PERAN_TIDAK_BERWENANG: tanpa akun';
  end if;
  if kso.peran_saya() is null or not (kso.peran_saya() = any(p_peran)) then
    raise exception 'PERAN_TIDAK_BERWENANG: % butuh salah satu dari %', coalesce(kso.peran_saya(),'tanpa peran'), p_peran;
  end if;
end $$;

-- ---------- pembungkus untuk aplikasi ----------
-- bot WhatsApp (akun peran bot_wa). AM tidak pernah memanggil fungsi tulis langsung.
create or replace function kso.app_bot_buat_draft(
  p_am text, p_faskes text, p_alat text, p_jumlah int, p_volume int, p_sumber text, p_harga numeric,
  p_unit kso.unit_status default null, p_tenor int default null, p_klausul text[] default '{}',
  p_pendukung jsonb default '[]', p_wa_thread text default null, p_lead kso.lead_asal default null,
  p_biaya_instalasi numeric default null)
returns bigint language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa');
      return kso.buat_draft(p_am, p_faskes, p_alat, p_jumlah, p_volume, p_sumber, p_harga, p_unit, p_tenor,
                            p_klausul, p_pendukung, p_wa_thread, p_lead, p_biaya_instalasi); end $$;

-- bot bertindak atas nama AM pengirim pesan; setiap aksi atas usulan yang sudah ada memeriksa kepemilikan
create or replace function kso.wajib_milik(p_id bigint, p_am text) returns void
language plpgsql stable security definer set search_path = kso, public as $$
begin
  if not exists (select 1 from kso.rencana_kso where id = p_id and am_id = p_am) then
    raise exception 'BUKAN_MILIK_PENGIRIM: rencana % bukan milik %', p_id, p_am; end if;
end $$;

create or replace function kso.app_bot_ajukan(p_id bigint, p_am text) returns kso.jalur
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am); return kso.ajukan(p_id, 'ai_wa'); end $$;

create or replace function kso.app_bot_minta_kelonggaran(p_id bigint, p_am text, p_alasan text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am); perform kso.minta_kelonggaran(p_id, p_alasan, 'ai_wa'); end $$;

create or replace function kso.app_bot_catat_kalah(p_id bigint, p_am text, p_alasan text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am); perform kso.catat_kalah(p_id, p_alasan, 'ai_wa'); end $$;

create or replace function kso.app_catat_kalah(p_id bigint, p_alasan text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('admin_sales'); perform kso.catat_kalah(p_id, p_alasan, 'admin_sales'); end $$;

-- HOD: dua tab, dua kata kerja
create or replace function kso.app_putus_hod(p_id bigint, p_keputusan text, p_catatan text default null)
returns kso.status_rencana language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('hod'); return kso.putus_hod(p_id, kso.ref_saya(), p_keputusan, p_catatan); end $$;

create or replace function kso.app_pendapat_hod(p_id bigint, p_catatan text)
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('hod'); perform kso.simpan_pendapat_hod(p_id, kso.ref_saya(), p_catatan); end $$;

-- Komite
create or replace function kso.app_usulkan(p_id bigint, p_forum bigint, p_usulan kso.usulan_komite, p_syarat jsonb default null,
  p_data_kurang text default null, p_pemilik text default null, p_tanggal_kembali date default null, p_alasan text default null,
  p_mandat_usulan jsonb default null)
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('komite','sekretaris');
      perform kso.usulkan(p_id, p_forum, p_usulan, p_syarat, p_data_kurang, p_pemilik, p_tanggal_kembali, p_alasan, p_mandat_usulan); end $$;

create or replace function kso.app_tarik_ke_forum(p_id bigint, p_alasan text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('komite','sekretaris'); perform kso.tarik_ke_forum(p_id, p_alasan, kso.peran_saya()); end $$;

-- Direksi
create or replace function kso.app_putus_direksi(p_id bigint, p_putusan kso.putusan_direksi, p_catatan text default null,
  p_lantai numeric default null, p_target numeric default null, p_tenor_maks int default null,
  p_capex_maks numeric default null, p_volume_min int default null, p_klausul_dilarang text[] default '{}')
returns kso.status_rencana language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('direksi');
      return kso.putus_direksi(p_id, p_putusan, p_catatan, p_lantai, p_target, p_tenor_maks, p_capex_maks, p_volume_min, p_klausul_dilarang); end $$;

create or replace function kso.app_catat_pks(p_id bigint, p_harga_deal numeric) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('direksi','sekretaris'); perform kso.catat_pks(p_id, p_harga_deal, kso.peran_saya()); end $$;

-- Admin sales
create or replace function kso.app_terbitkan_penawaran(p_id bigint, p_harga numeric)
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('admin_sales'); perform kso.terbitkan_penawaran(p_id, p_harga, 'admin_sales:' || coalesce(kso.uid_saya(),'')); end $$;

-- Teknik
create or replace function kso.app_serah_terima(p_id bigint, p_nomor_seri text, p_tanggal date default null) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('teknik'); perform kso.serah_terima(p_id, p_nomor_seri, p_tanggal, 'teknik'); end $$;

-- hanya pembungkus yang boleh dipanggil akun yang login
revoke execute on all functions in schema kso from public;
grant execute on function
  kso.param(text), kso.rp(numeric), kso.hari_ini(), kso.jam_wib(date,time),
  kso.hod_untuk(bigint), kso.uid_saya(), kso.peran_saya(), kso.ref_saya(), kso.boleh_lihat(bigint),
  kso.app_bot_buat_draft(text,text,text,int,int,text,numeric,kso.unit_status,int,text[],jsonb,text,kso.lead_asal,numeric),
  kso.app_bot_ajukan(bigint,text), kso.app_bot_minta_kelonggaran(bigint,text,text), kso.app_bot_catat_kalah(bigint,text,text),
  kso.app_catat_kalah(bigint,text),
  kso.app_putus_hod(bigint,text,text), kso.app_pendapat_hod(bigint,text),
  kso.app_usulkan(bigint,bigint,kso.usulan_komite,jsonb,text,text,date,text,jsonb), kso.app_tarik_ke_forum(bigint,text),
  kso.app_putus_direksi(bigint,kso.putusan_direksi,text,numeric,numeric,int,numeric,int,text[]),
  kso.app_catat_pks(bigint,numeric), kso.app_terbitkan_penawaran(bigint,numeric), kso.app_serah_terima(bigint,text,date)
  to wrg_app;
