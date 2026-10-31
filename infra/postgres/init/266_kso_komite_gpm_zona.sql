-- 266 — F170 v2: GPM deal + 4 zona + 7 gerbang v2 + mandat tiga harga (Pedoman Komite KSO Forum v01, Fase C1)
--
-- Pedoman (27 Okt 2026) mengganti ukuran F170 v1 (capex ≤ Rp 60 jt, harga ≥ daftar kategori):
--
--   GPM deal = 1 − (reagen/tes + (reagen tetap + QC)·n/volume + (HPP·n + instalasi)/(tenor·volume)) ÷ harga
--
-- dengan angka dari F172 (public.kso_bottomline_model_v lewat public.kso_analyzer.model_key) dan batas
-- zona/tenor dari public.kso_bottomline_parameter — SATU sumber angka dengan tab Bottom Line Alat.
--
-- Zona: ≥ 55% AM · 50–55% dua HOD · 45–50% Forum · < 45% Direktur. Satu gerbang (2–7) tidak hijau =
-- naik satu level kewenangan. Keputusan user 31 Okt:
--   * zona AM (setelah eskalasi) → DIPUTUS_AM + mandat otomatis, tanpa persetujuan siapa pun;
--     tetap muncul di Agenda B forum berikutnya (laporan).
--   * zona HOD → jalur cepat dua HOD (mesin lama putus_hod).
--   * zona Forum DAN Direktur → jalur forum (forum mengusulkan, Direktur memutus — mesin lama);
--     zona Direktur wajib alasan strategis tertulis (kecuali Hemodialisa).
--   * verifikasi bukti volume oleh Sekretaris hanya untuk zona Forum & Direktur.
-- Hemodialisa (satuan tindakan) tidak memakai zona → selalu forum/Direktur (Kalkulator HD).
-- Data kosong = gerbang "belum bisa dicek" = tidak hijau (Pedoman).
--
-- Tujuh gerbang v2 (nomor = urutan Pedoman):
--   1 GPM deal (bottom standar)   2 Volume terbukti          3 Relokasi dulu (unit idle sejenis)
--   4 Coverage cabang + teknisi   5 Piutang ≤ 60 hr & ≤ 3×    6 Tenor ≤ 36 bln   7 Klausul standar
-- Gerbang capex 60 jt, harga daftar, unit baru, dan anti-pemecahan paket DIHAPUS (GPM per deal
-- menggantikannya; pecah_paket tak lagi diisi).
--
-- Mandat: harga pembuka = harga @ GPM 55%, target = @ 50%, batas bawah (harga_lantai) = @ 45%, di volume
-- yang dibuktikan, dibulatkan ke atas per Rp 100; berlaku 30 hari (mesin lama). Data GPM tak lengkap →
-- jatuh ke perilaku lama (harga daftar kategori, lalu harga AM).

set search_path = kso, public;

-- ---------- kolom ----------
alter table kso.rencana_kso
  add column if not exists gpm_deal                 numeric,
  add column if not exists zona                     text check (zona in ('am','hod','forum','direktur')),
  add column if not exists zona_dasar               text check (zona_dasar in ('am','hod','forum','direktur')),
  add column if not exists alasan_strategis         text,
  add column if not exists volume_terverifikasi     boolean,       -- NULL = belum diperiksa Sekretaris
  add column if not exists volume_verifikasi_oleh   text,
  add column if not exists volume_verifikasi_at     timestamptz,
  add column if not exists volume_verifikasi_catatan text;
comment on column kso.rencana_kso.zona_dasar is 'Zona dari GPM saja (266). zona = setelah eskalasi gerbang merah & aturan grup.';

alter table kso.mandat
  add column if not exists harga_pembuka   numeric,
  add column if not exists volume_terbukti int;
comment on column kso.mandat.harga_pembuka is 'Pedoman v01: harga @ GPM 55%. harga_target = @ 50%, harga_lantai = @ 45% (batas bawah AM).';

-- transisi zona AM
insert into kso.transisi values
  ('DIAJUKAN','DIPUTUS_AM'), ('DIPUTUS_AM','PENAWARAN_TERBIT'), ('DIPUTUS_AM','JALUR_FORUM'), ('DIPUTUS_AM','KALAH')
on conflict do nothing;

-- bukti volume yang diterima Pedoman: rekap LIS/SIMRS, riwayat pembelian reagen RS, surat RS
create or replace function kso.tebak_label_sumber(p text) returns kso.label_sumber
language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~* '(belum|blm|tidak|tdk|ga|gak|nggak) *(ada)? *(data|sumber|angka)|^\s*belum ada\s*$' then 'belum_ada'::kso.label_sumber
    when p ~* '\m(lisan|kata|katanya|cerita|obrolan|ngobrol|perkiraan|kira|kiranya|estimasi|feeling|asumsi|tebakan)\M' then 'lisan'::kso.label_sumber
    when p ~* '\m(lis|simrs|sim|bpjs|laporan|rekap|rekapan|ekspor|export|log|sistem|data|tagihan|faktur|register|logbook|surat|po|pembelian|invoice|nota)\M' then 'data'::kso.label_sumber
    else null
  end $$;

-- ---------- angka dari F172 ----------
create or replace function kso.param_gpm(out tenor int, out g_am numeric, out g_hod numeric, out g_forum numeric)
language plpgsql stable as $$
begin
  -- plpgsql (bukan sql): tabel F172 cukup ada saat DIPANGGIL, tidak saat fungsi dibuat
  select p.bulan, p.gpm_am, p.gpm_hod, p.gpm_forum into tenor, g_am, g_hod, g_forum
    from public.kso_bottomline_parameter p where p.id = 1;
  tenor := coalesce(tenor, 36); g_am := coalesce(g_am, 0.55); g_hod := coalesce(g_hod, 0.50); g_forum := coalesce(g_forum, 0.45);
end $$;

create or replace function kso.zona_dari(p_gpm numeric) returns text language sql stable as $$
  select case when p_gpm is null then null
              when p_gpm >= (kso.param_gpm()).g_am then 'am'
              when p_gpm >= (kso.param_gpm()).g_hod then 'hod'
              when p_gpm >= (kso.param_gpm()).g_forum then 'forum'
              else 'direktur' end $$;

create or replace function kso.level_zona(p text) returns int language sql immutable as $$
  select case p when 'am' then 0 when 'hod' then 1 when 'forum' then 2 when 'direktur' then 3 end $$;
create or replace function kso.zona_level(p int) returns text language sql immutable as $$
  select (array['am','hod','forum','direktur'])[least(greatest(p,0),3) + 1] $$;

-- GPM deal satu rencana. Angka per unit dari F172 dikalikan jumlah unit; instalasi ikut HPP.
create or replace function kso.hitung_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, model_key text,
               biaya_per_tes numeric, harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql stable as $$
declare r kso.rencana_kso; p record; m record; v_n int; v_hpp numeric; v_tetap numeric; v_biaya numeric; v_sisa numeric;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into p from kso.param_gpm();
  select a.model_key as mk, b.hpp, b.biaya_per_tes as reagen, b.biaya_tetap_bulan as tetap, b.qc_bulan as qc, b.satuan
    into m
    from public.kso_analyzer a left join public.kso_bottomline_model_v b on b.model_key = a.model_key
   where a.kode = r.alat_kode
   order by a.model_key is null, a.id limit 1;
  model_key := m.mk; hd := coalesce(m.satuan = 'tindakan', false);
  if hd then
    zona := 'direktur'; catatan := 'Hemodialisa: Kalkulator HD — selalu Direktur'; return next; return;
  end if;
  if m.mk is null then catatan := 'Alat belum dipetakan ke model Bottom Line (Simulator → Kelola harga beli → Alat)';
  elsif m.hpp is null then catatan := 'HPP alat belum ada (Finance: HPP standar di Bottom Line Alat)';
  elsif m.reagen is null then catatan := 'Biaya reagen per tes belum ada (Finance: Bottom Line Alat)';
  elsif r.harga_per_test is null or r.harga_per_test <= 0 then catatan := 'Harga per tes belum diisi';
  elsif r.volume_estimasi is null or r.volume_estimasi <= 0 then catatan := 'Volume per bulan belum diisi';
  end if;
  if catatan is not null then return next; return; end if;

  v_n := coalesce(r.jumlah, 1);
  v_hpp := m.hpp * v_n + coalesce(r.biaya_instalasi, 0);
  v_tetap := (coalesce(m.tetap, 0) + coalesce(m.qc, 0)) * v_n;
  v_biaya := m.reagen + v_tetap / r.volume_estimasi + v_hpp / (p.tenor * r.volume_estimasi);
  biaya_per_tes := v_biaya;
  gpm := 1 - v_biaya / r.harga_per_test;
  zona := kso.zona_dari(gpm);
  harga_am := v_biaya / (1 - p.g_am);
  harga_hod := v_biaya / (1 - p.g_hod);
  harga_forum := v_biaya / (1 - p.g_forum);
  v_sisa := r.harga_per_test * (1 - p.g_forum) - m.reagen;
  volume_min_forum := case when v_sisa > 0 then (v_tetap + v_hpp / p.tenor) / v_sisa end;
  catatan := 'GPM ' || replace(to_char(gpm * 100, 'FM990.0'), '.', ',') || '% → zona '
             || case zona when 'am' then 'AM' when 'hod' then '2 HOD' when 'forum' then 'Forum' else 'Direktur' end;
  return next;
end $$;

-- ---------- tujuh gerbang v2 ----------
create or replace function kso.hitung_gerbang(p_id bigint, p_mode_hari_ini boolean default false)
returns table (no int, nama text, status kso.gerbang_status, nilai text)
language plpgsql as $$
declare
  r kso.rencana_kso; f kso.faskes; a kso.alat; k kso.kategori; g record;
  v_tek boolean; v_kel numeric; v_kl text; v_idle int;
  g_status kso.gerbang_status; g_nilai text;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into f from kso.faskes   where id = r.faskes_id;
  select * into a from kso.alat     where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  select * into g from kso.hitung_gpm(p_id);
  update kso.rencana_kso set gpm_deal = g.gpm, zona_dasar = g.zona, pecah_paket = false where id = p_id;
  delete from kso.gerbang_hasil where rencana_id = p_id;

  -- 1. GPM deal (bottom standar) — hijau = zona AM/HOD/Forum; merah = zona Direktur (< batas Forum)
  g_status := case when g.hd or g.gpm is null then 'belum'
                   when g.zona = 'direktur' then 'merah' else 'hijau' end;
  insert into kso.gerbang_hasil values (p_id, 1, 'GPM deal (bottom standar)', g_status, g.catatan);

  -- 2. volume terbukti: bukti tertulis (LIS/SIMRS, pembelian reagen, surat RS); lisan tidak diterima.
  --    Zona Forum & Direktur: wajib diverifikasi Sekretaris (keputusan 31 Okt).
  if p_mode_hari_ini or r.volume_estimasi is null then
    g_status := 'belum'; g_nilai := 'Volume belum diisi';
  elsif r.volume_terverifikasi is false then
    g_status := 'merah'; g_nilai := 'Bukti ditolak Sekretaris' || coalesce(': ' || r.volume_verifikasi_catatan, '');
  elsif r.volume_sumber_label is distinct from 'data' then
    g_status := case when r.volume_sumber_label is null then 'belum' else 'merah' end;
    g_nilai := case r.volume_sumber_label when 'lisan' then 'Perkiraan lisan — tidak diterima sebagai bukti'
                                          when 'belum_ada' then 'Belum ada bukti volume'
                                          else 'Jenis bukti belum dikenali — sebut LIS/SIMRS, pembelian reagen, atau surat RS' end;
  elsif g.zona in ('forum','direktur') and r.volume_terverifikasi is null then
    g_status := 'belum'; g_nilai := 'Bukti tertulis, menunggu verifikasi Sekretaris';
  else
    g_status := 'hijau';
    g_nilai := r.volume_estimasi || ' tes/bln · bukti tertulis' || case when r.volume_terverifikasi then ' · diverifikasi Sekretaris' else '' end;
  end if;
  insert into kso.gerbang_hasil values (p_id, 2, 'Volume terbukti', g_status, g_nilai);

  -- 3. relokasi dulu: unit idle sejenis (F172: di faskes, omzet 12 bln nol) dipakai sebelum beli baru
  if p_mode_hari_ini or g.model_key is null then
    g_status := 'belum'; g_nilai := 'Model alat belum dipetakan — daftar idle tidak bisa dicek';
  elsif r.unit_status is not null and r.unit_status <> 'baru' then
    g_status := 'hijau'; g_nilai := 'Memakai unit ' || replace(r.unit_status::text, '_', '-');
  else
    select count(*) into v_idle from public.kso_bottomline_unit_v u
     where u.model_key = g.model_key and u.account_id is not null and coalesce(u.omzet_12, 0) <= 0;
    g_status := case when v_idle > 0 then 'merah' else 'hijau' end;
    g_nilai := case when v_idle > 0 then v_idle || ' unit idle sejenis bisa direlokasi — pakai unit itu dulu'
                    else 'Tidak ada unit idle sejenis' end;
  end if;
  insert into kso.gerbang_hasil values (p_id, 3, 'Relokasi dulu', g_status, g_nilai);

  -- 4. coverage cabang + teknisi tersertifikasi (v1 gerbang 3)
  if p_mode_hari_ini then g_status := 'belum'; g_nilai := 'Register teknisi belum ada di OS';
  elsif f.cabang is null then g_status := 'merah'; g_nilai := 'Di luar coverage cabang';
  elsif not exists (select 1 from kso.cabang_teknisi t where t.kategori = a.kategori) then
    g_status := 'belum'; g_nilai := 'Register teknisi ' || lower(k.label) || ' belum ada di OS';
  else
    v_tek := exists (select 1 from kso.cabang_teknisi t where t.cabang = f.cabang and t.kategori = a.kategori);
    g_status := case when v_tek then 'hijau' else 'merah' end;
    g_nilai  := 'Cabang ' || f.cabang || ' · ' || case when v_tek then 'teknisi ' else 'tidak ada teknisi ' end || lower(k.label);
  end if;
  insert into kso.gerbang_hasil values (p_id, 4, 'Coverage cabang + teknisi', g_status, g_nilai);

  -- 5. piutang faskes (v1 gerbang 5)
  if p_mode_hari_ini or f.piutang_hari is null then
    g_status := 'belum'; g_nilai := 'AR aging belum ada di OS';
  elsif coalesce(f.tagihan_bulanan,0) = 0 and coalesce(f.piutang_nilai,0) = 0 then
    g_status := 'hijau'; g_nilai := 'Faskes baru — belum ada tagihan';
  else
    v_kel := case when coalesce(f.tagihan_bulanan,0) > 0 then f.piutang_nilai / f.tagihan_bulanan else 99 end;
    g_status := case when f.piutang_hari <= kso.param('piutang_hari_maks')
                      and v_kel <= kso.param('piutang_kelipatan_maks') then 'hijau' else 'merah' end;
    g_nilai  := f.piutang_hari || ' hari · '
                || case when v_kel >= 99 then 'ada piutang tanpa tagihan berjalan'
                        else replace(to_char(v_kel,'FM990.0'),'.',',') || '× tagihan bulanan' end;
  end if;
  insert into kso.gerbang_hasil values (p_id, 5,
    'Piutang ≤ ' || kso.param('piutang_hari_maks') || ' hari dan ≤ ' || kso.param('piutang_kelipatan_maks') || '× tagihan', g_status, g_nilai);

  -- 6. tenor sejak serah terima (v1 gerbang 6)
  if p_mode_hari_ini or r.tenor_bulan is null then g_status := 'belum'; g_nilai := 'Tenor belum diisi';
  else g_status := case when r.tenor_bulan <= kso.param('tenor_maks_bulan') then 'hijau' else 'merah' end;
       g_nilai  := r.tenor_bulan || ' bulan sejak serah terima';
  end if;
  insert into kso.gerbang_hasil values (p_id, 6, 'Tenor ≤ ' || kso.param('tenor_maks_bulan') || ' bulan', g_status, g_nilai);

  -- 7. klausul standar WRG (v1 gerbang 7)
  select string_agg(kk.label, ', ' order by kk.urut) into v_kl
    from kso.rencana_klausul rk join kso.klausul_khusus kk on kk.kode = rk.klausul_kode where rk.rencana_id = p_id;
  insert into kso.gerbang_hasil values (p_id, 7, 'Klausul standar WRG',
    (case when v_kl is null then 'hijau' else 'merah' end)::kso.gerbang_status, coalesce(v_kl,'Tanpa klausul khusus'));

  return query select gh.no, gh.nama, gh.status, gh.nilai from kso.gerbang_hasil gh where gh.rencana_id = p_id order by gh.no;
end $$;
revoke execute on function kso.hitung_gerbang(bigint, boolean) from public;

-- ---------- AM: ajukan → zona ----------
create or replace function kso.ajukan(p_id bigint, p_oleh text default 'ai_wa')
returns kso.jalur language plpgsql as $$
declare r kso.rencana_kso; v_kurang text[] := '{}'; v_merah int; v_alasan text; v_hod int; g kso.grup_mitra;
        v_level int; v_hd boolean; v_zona text;
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

  -- level dari zona GPM; data GPM tak lengkap = gerbang belum bisa dicek = forum
  v_level := coalesce(kso.level_zona(v_zona), 2);
  -- satu gerbang (2–7) tidak hijau = naik satu level kewenangan
  select count(*) into v_merah from kso.gerbang_hasil where rencana_id = p_id and no between 2 and 7 and status <> 'hijau';
  if v_merah > 0 then v_level := least(v_level + 1, 3); end if;

  -- aturan di luar gerbang yang tetap memaksa forum (SK Pasal 14 dan 16)
  select gm.* into g from kso.faskes f join kso.grup_mitra gm on gm.grup = f.grup where f.id = r.faskes_id;
  if g.grup is not null and coalesce(g.rating_terburuk,1) >= 4 then
    v_alasan := 'Grup ' || g.grup || ' punya KSO rating ' || g.rating_terburuk || ' — dibekukan, wajib forum (SK Pasal 14)';
  elsif g.grup is not null and g.pks_lengkap is false then
    v_alasan := 'Grup ' || g.grup || ' masih punya KSO tanpa PKS bertanda tangan (SK Pasal 16)';
  elsif g.grup is not null and (g.rating_terburuk is null or g.pks_lengkap is null) then
    v_alasan := 'Status grup ' || g.grup || ' belum diketahui — rating atau kelengkapan PKS kosong';
  end if;
  if v_level = 1 then
    select count(*) into v_hod from kso.hod_untuk(p_id);
    if v_alasan is null and v_hod < 2 then v_alasan := 'Routing HOD tidak lengkap (' || v_hod || ' dari 2 kursi)'; end if;
  end if;
  if v_alasan is not null then v_level := greatest(v_level, 2); end if;
  if coalesce(v_hd, false) then v_level := 3; end if;

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

-- ---------- mandat otomatis: tiga harga ----------
create or replace function kso.mandat_otomatis(p_id bigint) returns void language plpgsql as $$
declare r kso.rencana_kso; a kso.alat; k kso.kategori; g record; v_lantai numeric; v_target numeric; v_pembuka numeric;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into a from kso.alat where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  select * into g from kso.hitung_gpm(p_id);
  if g.harga_forum is not null then
    v_lantai  := ceil(g.harga_forum / 100) * 100;
    v_target  := ceil(g.harga_hod / 100) * 100;
    v_pembuka := ceil(g.harga_am / 100) * 100;
  else                                            -- data GPM tak lengkap → perilaku v1
    v_lantai  := coalesce(k.harga_standar_per_test, r.harga_per_test);
    v_target  := greatest(r.harga_per_test, v_lantai);
    v_pembuka := null;
  end if;
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, harga_pembuka, volume_terbukti, tenor_maks_bulan, capex_maks,
                          volume_minimum, klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, v_lantai, v_target, v_pembuka, r.volume_estimasi, r.tenor_bulan,
          a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0), floor(r.volume_estimasi * kso.param('volume_minimum_rasio')),
          array(select kode from kso.klausul_khusus where kode in ('eksklusivitas','jaminan_volume','alat_jatuh')),
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'otomatis')
  on conflict (rencana_id) do nothing;
end $$;

-- ---------- Sekretaris: verifikasi bukti volume ----------
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
end $$;

create or replace function kso.app_verifikasi_volume(p_id bigint, p_sah boolean, p_catatan text default null)
returns void language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('sekretaris');
      perform kso.verifikasi_volume(p_id, p_sah, p_catatan, 'sekretaris:' || coalesce(kso.uid_saya(),'')); end $$;

revoke execute on function kso.verifikasi_volume(bigint, boolean, text, text), kso.hitung_gpm(bigint) from public;
grant execute on function kso.app_verifikasi_volume(bigint, boolean, text) to wrg_app;

-- ---------- DIPUTUS_AM ikut di objek lama yang menyebut DIPUTUS_HOD ----------
-- Ditambal dari definisi yang SEDANG BERLAKU (bukan disalin dari berkas lama), dengan pemeriksaan
-- bahwa penggantiannya memang terjadi — dev & main boleh punya versi view berbeda.
do $$
declare v_def text; v_baru text; x record;
begin
  -- view: daftar status di ARRAY[...]
  for x in select unnest(array['kso.v_antrean','kso.v_ringkasan']) as nama loop
    v_def := pg_get_viewdef(x.nama::regclass, true);
    if position('DIPUTUS_AM' in v_def) > 0 then continue; end if;
    -- tipe bisa tertulis 'kso.status_rencana' atau 'status_rencana' tergantung search_path
    v_baru := regexp_replace(v_def, '''DIPUTUS_HOD''::([a-z_.]+)', '''DIPUTUS_AM''::\1, ''DIPUTUS_HOD''::\1', 'g');
    if v_baru = v_def then raise exception 'TAMBAL_GAGAL: % tidak menyebut DIPUTUS_HOD', x.nama; end if;
    execute format('create or replace view %s as %s', x.nama, v_baru);
  end loop;
  -- fungsi: daftar status di IN (...)
  for x in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'kso' and p.proname in ('boleh_lihat','susun_agenda') loop
    v_def := pg_get_functiondef(x.oid);
    if position('DIPUTUS_AM' in v_def) > 0 then continue; end if;
    v_baru := replace(v_def, '''DIPUTUS_HOD''', '''DIPUTUS_AM'',''DIPUTUS_HOD''');
    if v_baru = v_def then raise exception 'TAMBAL_GAGAL: fungsi % tidak menyebut DIPUTUS_HOD', x.proname; end if;
    execute v_baru;
  end loop;
end $$;
