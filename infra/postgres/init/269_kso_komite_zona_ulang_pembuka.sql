-- F170 Komite KSO — dua perbaikan dari uji end-to-end dev 3 Nov 2026 (laporan "Uji End-to-End Komite KSO").
--
-- 1) Zona dihitung ulang sesudah Sekretaris memeriksa bukti volume.
--    Gerbang 2 zona Forum/Direktur baru hijau SESUDAH verifikasi, padahal verifikasi hanya bisa dilakukan
--    sesudah usulan dikirim. Dulu zona ditetapkan sekali di kso.ajukan → setiap usulan zona Forum naik
--    satu level ke "Direktur" dan tertahan di sana walau bukti sudah disahkan (D56 dev: zona dasar Forum,
--    7/7 gerbang hijau, zona tetap Direktur). Aturan penentuan level dipindah ke kso.tentukan_level
--    (dipakai kso.ajukan DAN kso.zona_ulang) supaya hanya ada satu sumber aturan.
--    kso.zona_ulang hanya mengubah zona + alasan_forum, tidak pernah status/jalur: usulan yang sudah di
--    jalur forum tetap di forum (level dijepit ≥ 2) — Forum ↔ Direktur saja.
--
-- 2) Mandat dari putusan Direksi membawa harga pembuka + volume terbukti.
--    Mandat otomatis (zona AM/HOD) punya pembuka @GPM 55%; mandat Direksi tidak → penawaran jalur forum
--    dibuka di harga target. kso.putus_direksi kini menerima p_pembuka (kosong = @GPM 55% dari Bottom Line,
--    tak pernah di bawah target) dan memeriksa urutan pembuka ≥ target ≥ lantai.

-- ---------- 1. satu sumber aturan level kewenangan ----------
create or replace function kso.tentukan_level(p_id bigint, out level int, out alasan text)
language plpgsql as $$
declare r kso.rencana_kso; v_merah int; v_hod int; g kso.grup_mitra; v_hd boolean;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select hd into v_hd from kso.hitung_gpm(p_id);
  -- level dari zona GPM; data GPM tak lengkap = gerbang belum bisa dicek = forum
  level := coalesce(kso.level_zona(r.zona_dasar), 2);
  -- satu gerbang (2–7) tidak hijau = naik satu level kewenangan
  select count(*) into v_merah from kso.gerbang_hasil where rencana_id = p_id and no between 2 and 7 and status <> 'hijau';
  if v_merah > 0 then level := least(level + 1, 3); end if;

  -- aturan di luar gerbang yang tetap memaksa forum (SK Pasal 14 dan 16)
  select gm.* into g from kso.faskes f join kso.grup_mitra gm on gm.grup = f.grup where f.id = r.faskes_id;
  if g.grup is not null and coalesce(g.rating_terburuk,1) >= 4 then
    alasan := 'Grup ' || g.grup || ' punya KSO rating ' || g.rating_terburuk || ' — dibekukan, wajib forum (SK Pasal 14)';
  elsif g.grup is not null and g.pks_lengkap is false then
    alasan := 'Grup ' || g.grup || ' masih punya KSO tanpa PKS bertanda tangan (SK Pasal 16)';
  elsif g.grup is not null and (g.rating_terburuk is null or g.pks_lengkap is null) then
    alasan := 'Status grup ' || g.grup || ' belum diketahui — rating atau kelengkapan PKS kosong';
  end if;
  if level = 1 then
    select count(*) into v_hod from kso.hod_untuk(p_id);
    if alasan is null and v_hod < 2 then alasan := 'Routing HOD tidak lengkap (' || v_hod || ' dari 2 kursi)'; end if;
  end if;
  if alasan is not null then level := greatest(level, 2); end if;
  if coalesce(v_hd, false) then level := 3; end if;
end $$;

-- ---------- AM: ajukan → zona (isi sama dengan 266, aturan level lewat kso.tentukan_level) ----------
create or replace function kso.ajukan(p_id bigint, p_oleh text default 'ai_wa')
returns kso.jalur language plpgsql as $$
declare r kso.rencana_kso; v_kurang text[] := '{}'; v_level int; v_alasan text; v_hd boolean; v_zona text;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if r.status not in ('DRAFT','DITAHAN') then raise exception 'TIDAK_BISA_DIAJUKAN: status %', r.status; end if;
  if coalesce(btrim(r.volume_sumber),'') = '' then
    raise exception 'SUMBER_VOLUME_KOSONG' using hint = 'Boleh "catatan lisan", boleh "belum ada", tidak boleh kosong.';
  end if;
  if r.volume_estimasi is null then v_kurang := array_append(v_kurang, 'volume_estimasi'::text); end if;
  if r.harga_per_test  is null then v_kurang := array_append(v_kurang, 'harga_per_test'::text); end if;
  if r.tenor_bulan     is null then v_kurang := array_append(v_kurang, 'tenor_bulan'::text); end if;
  if not exists (select 1 from kso.rencana_pendukung where rencana_id = p_id) then
    v_kurang := array_append(v_kurang, 'pendukung (min 1)'::text); end if;
  if array_length(v_kurang,1) > 0 then raise exception 'KOLOM_WAJIB_KOSONG: %', array_to_string(v_kurang, ', '); end if;

  perform kso.hitung_gerbang(p_id);
  select zona_dasar into v_zona from kso.rencana_kso where id = p_id;
  select hd into v_hd from kso.hitung_gpm(p_id);
  -- zona Direktur karena margin (bukan HD) wajib alasan strategis tertulis (Pedoman)
  if v_zona = 'direktur' and not coalesce(v_hd, false) and coalesce(btrim(r.alasan_strategis), '') = '' then
    raise exception 'ALASAN_STRATEGIS_WAJIB' using hint = 'GPM di bawah batas Forum: tulis alasan strategis sebelum dikirim.';
  end if;

  update kso.rencana_kso set diajukan_at = now(), alasan_forum = null,
         nomor = coalesce(nomor, 'KSO-' || to_char(kso.hari_ini(),'YYYY') || '-' || lpad(id::text,4,'0'))
   where id = p_id;
  perform kso.ubah_status(p_id, 'DIAJUKAN', p_oleh);

  select t.level, t.alasan into v_level, v_alasan from kso.tentukan_level(p_id) t;
  update kso.rencana_kso set zona = kso.zona_level(v_level), alasan_forum = v_alasan where id = p_id;
  if v_level = 0 then
    update kso.rencana_kso set jalur = 'AM' where id = p_id;
    perform kso.ubah_status(p_id, 'DIPUTUS_AM', 'mesin_zona');
    perform kso.mandat_otomatis(p_id);
    return 'AM';
  elsif v_level = 1 then
    update kso.rencana_kso set jalur = 'CEPAT' where id = p_id;
    perform kso.ubah_status(p_id, 'JALUR_CEPAT', 'mesin_zona');
    return 'CEPAT';
  end if;
  update kso.rencana_kso set jalur = 'FORUM' where id = p_id;
  perform kso.ubah_status(p_id, 'JALUR_FORUM', 'mesin_zona');
  return 'FORUM';
end $$;

-- ---------- zona ulang: hanya usulan yang sudah di jalur forum, Forum ↔ Direktur ----------
create or replace function kso.zona_ulang(p_id bigint) returns void language plpgsql as $$
declare r kso.rencana_kso; v_level int; v_alasan text;
begin
  select * into r from kso.rencana_kso where id = p_id;
  if r.jalur is distinct from 'FORUM' or r.status not in ('JALUR_FORUM','DIAGENDAKAN','DITAHAN') then return; end if;
  select t.level, t.alasan into v_level, v_alasan from kso.tentukan_level(p_id) t;
  update kso.rencana_kso set zona = kso.zona_level(greatest(v_level, 2)), alasan_forum = v_alasan, diubah_at = now()
   where id = p_id;
end $$;

-- ---------- Sekretaris: verifikasi bukti volume → gerbang + zona ----------
create or replace function kso.verifikasi_volume(p_id bigint, p_sah boolean, p_catatan text, p_oleh text)
returns void language plpgsql as $$
declare v_status kso.status_rencana;
begin
  select status into v_status from kso.rencana_kso where id = p_id for update;
  if v_status is null then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if v_status not in ('DRAFT','DITAHAN','DIAJUKAN','JALUR_CEPAT','JALUR_FORUM','DIAGENDAKAN') then
    raise exception 'BUKAN_TAHAP_VERIFIKASI: status %', v_status; end if;
  if p_sah is false and coalesce(btrim(p_catatan), '') = '' then
    raise exception 'ALASAN_WAJIB' using hint = 'Bukti ditolak wajib disertai alasan.'; end if;
  update kso.rencana_kso set volume_terverifikasi = p_sah, volume_verifikasi_catatan = nullif(btrim(p_catatan), ''),
         volume_verifikasi_oleh = p_oleh, volume_verifikasi_at = now(), diubah_at = now()
   where id = p_id;
  perform kso.hitung_gerbang(p_id);
  perform kso.zona_ulang(p_id);
end $$;

-- ---------- 2. putusan Direksi: mandat tiga harga ----------
drop function if exists kso.app_putus_direksi(bigint, kso.putusan_direksi, text, numeric, numeric, int, numeric, int, text[]);
drop function if exists kso.putus_direksi(bigint, kso.putusan_direksi, text, numeric, numeric, int, numeric, int, text[]);

create function kso.putus_direksi(p_id bigint, p_putusan kso.putusan_direksi, p_catatan text default null,
  p_lantai numeric default null, p_target numeric default null, p_tenor_maks int default null,
  p_capex_maks numeric default null, p_volume_min int default null, p_klausul_dilarang text[] default '{}',
  p_pembuka numeric default null)
returns kso.status_rencana language plpgsql as $$
declare v_status kso.status_rencana; v_vol int; v_am numeric; v_pembuka numeric;
begin
  select status, volume_estimasi into v_status, v_vol from kso.rencana_kso where id = p_id for update;
  if v_status not in ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN') then
    raise exception 'BELUM_ADA_USULAN_KOMITE: status %', v_status; end if;
  if p_putusan <> 'TOLAK' and (p_lantai is null or p_target is null or p_tenor_maks is null
                               or p_capex_maks is null or p_volume_min is null) then
    raise exception 'MANDAT_TIDAK_LENGKAP' using hint =
      'Setuju atau Bersyarat wajib menetapkan lantai harga, harga pembuka, tenor maks, capex maks, dan volume minimum (SK Pasal 11 ayat 2).';
  end if;
  insert into kso.putusan_direksi_catatan values (p_id, p_putusan, p_catatan, now())
    on conflict (rencana_id) do update set putusan = excluded.putusan, catatan = excluded.catatan, at = now();
  if p_putusan = 'TOLAK' then perform kso.ubah_status(p_id, 'DITOLAK_DIREKSI', 'direksi'); return 'DITOLAK_DIREKSI'; end if;
  if exists (select 1 from kso.rencana_kso r join kso.faskes f on f.id = r.faskes_id join kso.grup_mitra g on g.grup = f.grup
              where r.id = p_id and (coalesce(g.rating_terburuk,1) >= 4 or g.pks_lengkap is false)) then
    raise exception 'GRUP_DIBEKUKAN' using hint = 'SK Pasal 14 ayat 2 dan Pasal 16 ayat 3: tidak ada belanja modal baru ke grup ini sampai perbaikan selesai.';
  end if;
  -- pembuka kosong = @GPM 55% di volume usulan (sama dengan mandat otomatis), tak pernah di bawah target
  select ceil(harga_am / 100) * 100 into v_am from kso.hitung_gpm(p_id);
  v_pembuka := coalesce(p_pembuka, greatest(v_am, p_target), p_target);
  if p_target < p_lantai or v_pembuka < p_target then
    raise exception 'MANDAT_URUTAN_HARGA' using hint = 'Harga pembuka ≥ target ≥ batas bawah (lantai).';
  end if;
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, harga_pembuka, volume_terbukti, tenor_maks_bulan, capex_maks,
                          volume_minimum, klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, p_lantai, p_target, v_pembuka, v_vol, p_tenor_maks, p_capex_maks, p_volume_min, p_klausul_dilarang,
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'direksi')
  on conflict (rencana_id) do update set harga_lantai = excluded.harga_lantai, harga_target = excluded.harga_target,
     harga_pembuka = excluded.harga_pembuka, volume_terbukti = excluded.volume_terbukti,
     tenor_maks_bulan = excluded.tenor_maks_bulan, capex_maks = excluded.capex_maks, volume_minimum = excluded.volume_minimum,
     klausul_dilarang = excluded.klausul_dilarang, berlaku_sampai = excluded.berlaku_sampai, sumber = 'direksi', terbit_at = now();
  perform kso.ubah_status(p_id, 'MANDAT_TERBIT', 'direksi'); return 'MANDAT_TERBIT';
end $$;

create function kso.app_putus_direksi(p_id bigint, p_putusan kso.putusan_direksi, p_catatan text default null,
  p_lantai numeric default null, p_target numeric default null, p_tenor_maks int default null,
  p_capex_maks numeric default null, p_volume_min int default null, p_klausul_dilarang text[] default '{}',
  p_pembuka numeric default null)
returns kso.status_rencana language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('direksi');
      return kso.putus_direksi(p_id, p_putusan, p_catatan, p_lantai, p_target, p_tenor_maks, p_capex_maks, p_volume_min,
                               p_klausul_dilarang, p_pembuka); end $$;

-- fungsi baru di schema kso terbuka untuk PUBLIC secara bawaan → tutup; hanya pembungkus app_* untuk aplikasi
revoke execute on function kso.tentukan_level(bigint), kso.zona_ulang(bigint),
  kso.putus_direksi(bigint, kso.putusan_direksi, text, numeric, numeric, int, numeric, int, text[], numeric),
  kso.app_putus_direksi(bigint, kso.putusan_direksi, text, numeric, numeric, int, numeric, int, text[], numeric) from public;
grant execute on function
  kso.app_putus_direksi(bigint, kso.putusan_direksi, text, numeric, numeric, int, numeric, int, text[], numeric) to wrg_app;
