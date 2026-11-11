-- 307 — F170 Komite KSO: ALAT BARU (alat yang belum ada di database) dari #KSO WhatsApp.
--
-- Keputusan product owner (11 Nov 2026): "kalau alatnya gak ada, tampung aja dulu, tapi ditandai merah, karena
-- gerbang alat tidak ada di database". Sampai 306 usulan yang alatnya tak cocok ke katalog kso.alat hanya bisa
-- menunggu AM memilih salah satu saran (#KSO ALAT 1) — alat merek lain (mis. Wienerlab CM 250) tidak bisa dicatat.
-- Sejak 307 (pola faskes baru 303):
--   * alat mirip                → saran tetap ditawarkan + pilihan "#KSO ALAT BARU";
--   * tidak ada yang mirip      → alat SEMENTARA dibuat langsung (kode 'BARU-<n>', baru = true, kategori BARU).
-- Alat sementara: tanpa HPP/model Bottom Line → GPM tak bisa dihitung. kso.hitung_gpm memberi zona 'direktur'
-- (catatan "Alat belum ada di database"), gerbang 1 MERAH (bukan 'belum'), dan usulan BOLEH diajukan — langsung Zona
-- Direktur (keputusan yang sama) tanpa wajib ALASAN strategis (alasannya bukan margin rendah, melainkan data alat).
-- harga_po = 0 (kolom NOT NULL; capex tak terhitung sampai alat masuk katalog).
--
-- kso.segarkan_referensi (228) hanya meng-upsert kode dari public.kso_analyzer dan tak pernah menghapus, jadi baris
-- 'BARU-<n>' tak tersentuh. CHECK kode 'BARU-%' ⇔ baru supaya kode katalog tak pernah menjadi baris sementara.
--
-- hitung_gpm (302), hitung_gerbang (266) dan ajukan (269) DITAMBAL pada definisi yang berlaku (pg_get_functiondef,
-- pola 285) — bukan ditulis ulang. Idempoten.

set search_path = kso, public;

-- ---------- kategori penampung + kolom alat ----------
insert into kso.kategori (kode, label, harga_standar_per_test, kontribusi_asumsi)
values ('BARU', 'Alat baru', null, null)
on conflict (kode) do nothing;

alter table kso.alat
  add column if not exists baru            boolean not null default false,
  add column if not exists dibuat_oleh_am  text references kso.am(id),
  add column if not exists dibuat_at       timestamptz;
alter table kso.alat drop constraint if exists alat_baru_kode_ck;
alter table kso.alat add constraint alat_baru_kode_ck check (baru = (kode like 'BARU-%'));
create index if not exists alat_baru_nama_idx on kso.alat (upper(nama)) where baru;
comment on column kso.alat.baru is '307: alat SEMENTARA dari #KSO (belum ada di database) — kode BARU-<n>, gerbang GPM merah, zona Direktur.';

create sequence if not exists kso.alat_baru_seq;
revoke all on sequence kso.alat_baru_seq from public;
do $$ declare r text; begin
  foreach r in array array['wrg_app','wrg_readonly','wrg_demo_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on sequence kso.alat_baru_seq from %I', r);
    end if;
  end loop;
end $$;

-- ---------- bot: buat (atau pakai ulang) alat sementara ----------
create or replace function kso.app_bot_buat_alat_baru(p_am text, p_nama text)
returns text language plpgsql security definer set search_path = kso, public as $$
declare v_nama text := upper(regexp_replace(btrim(coalesce(p_nama, '')), '\s+', ' ', 'g'));
        v_kode text;
begin
  perform kso.wajib_peran('bot_wa');
  if length(v_nama) < 2 or length(v_nama) > 120 then raise exception 'ALAT_NAMA_TIDAK_SAH: %', v_nama; end if;
  if not exists (select 1 from kso.am where id = p_am) then raise exception 'AM_TIDAK_ADA: %', p_am; end if;
  -- nama sama (tanpa beda huruf besar/spasi) = alat yang sama: tidak digandakan
  select kode into v_kode from kso.alat where baru and upper(nama) = v_nama order by dibuat_at limit 1;
  if v_kode is not null then return v_kode; end if;
  v_kode := 'BARU-' || nextval('kso.alat_baru_seq');
  insert into kso.alat (kode, nama, kategori, harga_po, baru, dibuat_oleh_am, dibuat_at)
  values (v_kode, v_nama, 'BARU', 0, true, p_am, now());
  return v_kode;
end $$;
revoke execute on function kso.app_bot_buat_alat_baru(text, text) from public;
grant execute on function kso.app_bot_buat_alat_baru(text, text) to wrg_app;

-- ---------- tambal: hitung_gpm → alat baru = zona Direktur ----------
do $$
declare v_def text;
  v_jangkar constant text := $j$model_key := m.mk; hd := coalesce(m.satuan = 'tindakan', false);$j$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kso' and p.proname = 'hitung_gpm';
  if v_def is null then raise exception 'kso.hitung_gpm tidak ada'; end if;
  if position('Alat belum ada di database' in v_def) > 0 then return; end if;
  if position(v_jangkar in v_def) = 0 then raise exception 'jangkar hitung_gpm tidak ditemukan — periksa definisi sebelum menambal'; end if;
  execute replace(v_def, v_jangkar,
    E'-- 307: alat sementara (belum ada di database) — tanpa HPP/model; langsung zona Direktur\n'
    || E'  if exists (select 1 from kso.alat x where x.kode = r.alat_kode and x.baru) then\n'
    || E'    hd := false; zona := ''direktur''; catatan := ''Alat belum ada di database — dicatat sebagai alat baru, zona Direktur''; return next; return;\n'
    || E'  end if;\n  ' || v_jangkar);
end $$;

-- ---------- tambal: hitung_gerbang → gerbang 1 MERAH untuk alat baru ----------
do $$
declare v_def text;
  v_jangkar constant text := $j$g_status := case when g.hd or g.gpm is null then 'belum'$j$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kso' and p.proname = 'hitung_gerbang';
  if v_def is null then raise exception 'kso.hitung_gerbang tidak ada'; end if;
  if position('when a.baru then ''merah''' in v_def) > 0 then return; end if;
  if position(v_jangkar in v_def) = 0 then raise exception 'jangkar hitung_gerbang tidak ditemukan — periksa definisi sebelum menambal'; end if;
  execute replace(v_def, v_jangkar, $j$g_status := case when a.baru then 'merah' /* 307: alat belum ada di database */
                   when g.hd or g.gpm is null then 'belum'$j$);
end $$;

-- ---------- tambal: ajukan → alat baru tanpa wajib ALASAN strategis ----------
do $$
declare v_def text;
  v_jangkar constant text := $j$if v_zona = 'direktur' and not coalesce(v_hd, false) and coalesce(btrim(r.alasan_strategis), '') = '' then$j$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kso' and p.proname = 'ajukan';
  if v_def is null then raise exception 'kso.ajukan tidak ada'; end if;
  if position('307: alat baru' in v_def) > 0 then return; end if;
  if position(v_jangkar in v_def) = 0 then raise exception 'jangkar ajukan tidak ditemukan — periksa definisi sebelum menambal'; end if;
  execute replace(v_def, v_jangkar, $j$if v_zona = 'direktur' and not coalesce(v_hd, false) and coalesce(btrim(r.alasan_strategis), '') = ''
     and not exists (select 1 from kso.alat x where x.kode = r.alat_kode and x.baru) /* 307: alat baru → Direktur karena data, bukan margin */ then$j$);
end $$;
