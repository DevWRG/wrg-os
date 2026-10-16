-- 225 — F170 Komite KSO: fungsi (gerbang, routing HOD, mandat, agenda, transisi)
--
-- Sumber: Paket Komite KSO v1.0 (Direktur, 15 Okt 2026), berkas 03-database/002_fungsi.sql, disalin
-- TANPA perubahan isi supaya tetap identik dengan implementasi rujukan yang lulus 87 uji.
-- Uji: scripts/qa/kso-komite/jalankan_uji.sh (DB sekali pakai, bukan wrg_os_dev/prod).
-- Semua objek di schema `kso`; tidak menyentuh tabel OS yang sudah ada.

-- =====================================================================
-- Komite KSO — mesin gerbang, status machine, dan aksi tiap peran
-- Versi 1.0.1 · 16 Oktober 2026
--
-- Semua aksi lewat fungsi. Aplikasi (bot WA, Refine, n8n) TIDAK menulis
-- kolom status langsung — supaya transisi tidak bisa dilompati.
-- Fungsi di file ini adalah fungsi INTI: tidak bisa dipanggil langsung
-- oleh akun aplikasi (lihat 005). Akun aplikasi memanggil pembungkus app_*.
-- Semua tanggal dan jam bisnis memakai Asia/Jakarta, bukan zona server.
-- =====================================================================
set search_path = kso, public;

-- ---------- utilitas ----------
create or replace function kso.param(p text) returns numeric language sql stable
set search_path = kso, public as
$$ select nilai from kso.parameter where kunci = p $$;

create or replace function kso.hari_ini() returns date language sql stable as
$$ select (now() at time zone 'Asia/Jakarta')::date $$;

-- jam dinding Jakarta pada tanggal tertentu → timestamptz
create or replace function kso.jam_wib(p_tanggal date, p_jam time) returns timestamptz language sql immutable as
$$ select (p_tanggal + p_jam) at time zone 'Asia/Jakarta' $$;

create or replace function kso.rp(n numeric) returns text language sql immutable as $$
  select case when n is null then '—'
              when n >= 1e9 then 'Rp ' || replace(to_char(round(n/1e9,2),'FM999990.00'),'.',',') || ' M'
              when n >= 1e6 then 'Rp ' || replace(rtrim(rtrim(to_char(round(n/1e6,1),'FM999990.0'),'0'),'.'),'.',',') || ' jt'
              else 'Rp ' || replace(to_char(round(n),'FM999G999G990'),',','.') end $$;

-- ---------- transisi yang sah — tabel, bukan if-else, supaya bisa dibaca & diaudit ----------
create table if not exists kso.transisi (dari kso.status_rencana, ke kso.status_rencana, primary key (dari, ke));
insert into kso.transisi values
 ('DRAFT','DIAJUKAN'),('DITAHAN','DIAJUKAN'),
 ('DIAJUKAN','JALUR_CEPAT'),('DIAJUKAN','JALUR_FORUM'),
 ('JALUR_CEPAT','DIPUTUS_HOD'),('JALUR_CEPAT','DITOLAK_HOD'),('JALUR_CEPAT','JALUR_FORUM'),
 ('JALUR_FORUM','DIAGENDAKAN'),
 ('DIAGENDAKAN','DIREKOMENDASIKAN'),('DIAGENDAKAN','DIREKOMENDASIKAN_BERSYARAT'),
 ('DIAGENDAKAN','DITAHAN'),('DIAGENDAKAN','TIDAK_DIREKOMENDASIKAN'),
 ('DIREKOMENDASIKAN','MANDAT_TERBIT'),('DIREKOMENDASIKAN','DITOLAK_DIREKSI'),
 ('DIREKOMENDASIKAN_BERSYARAT','MANDAT_TERBIT'),('DIREKOMENDASIKAN_BERSYARAT','DITOLAK_DIREKSI'),
 ('TIDAK_DIREKOMENDASIKAN','MANDAT_TERBIT'),('TIDAK_DIREKOMENDASIKAN','DITOLAK_DIREKSI'),
 ('DIPUTUS_HOD','PENAWARAN_TERBIT'),('MANDAT_TERBIT','PENAWARAN_TERBIT'),
 ('DIPUTUS_HOD','JALUR_FORUM'),('MANDAT_TERBIT','JALUR_FORUM'),      -- ditarik komite / mandat kedaluwarsa
 ('DIPUTUS_HOD','KALAH'),('MANDAT_TERBIT','KALAH'),
 ('PENAWARAN_TERBIT','PKS_TTD'),('PENAWARAN_TERBIT','KALAH'),('PENAWARAN_TERBIT','JALUR_FORUM'),
 ('PKS_TTD','TERPASANG')
on conflict do nothing;

create or replace function kso.ubah_status(p_id bigint, p_ke kso.status_rencana, p_oleh text)
returns void language plpgsql as $$
declare v_dari kso.status_rencana;
begin
  select status into v_dari from kso.rencana_kso where id = p_id for update;
  if v_dari is null then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if not exists (select 1 from kso.transisi where dari = v_dari and ke = p_ke) then
    raise exception 'TRANSISI_TIDAK_SAH: % → % (rencana %)', v_dari, p_ke, p_id;
  end if;
  update kso.rencana_kso set status = p_ke, diubah_at = now() where id = p_id;
  insert into kso.riwayat_status (rencana_id, dari, ke, oleh) values (p_id, v_dari, p_ke, p_oleh);
end $$;

-- ---------- mesin tujuh gerbang ----------
-- p_mode_hari_ini = true mensimulasikan OS hari ini: gerbang 2–6 dianggap belum punya data.
-- Di produksi, status 'belum' muncul sendiri saat kolom sumbernya NULL — dan 'belum' = masuk forum.
create or replace function kso.hitung_gerbang(p_id bigint, p_mode_hari_ini boolean default false)
returns table (no int, nama text, status kso.gerbang_status, nilai text)
language plpgsql as $$
declare
  r kso.rencana_kso; f kso.faskes; a kso.alat; k kso.kategori;
  v_capex numeric; v_gabung numeric; v_n_gabung int; v_tek boolean; v_kel numeric; v_kl text;
  g_status kso.gerbang_status; g_nilai text;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into f from kso.faskes   where id = r.faskes_id;
  select * into a from kso.alat     where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  delete from kso.gerbang_hasil where rencana_id = p_id;

  -- 1. capex (harga PO aktual + instalasi) + aturan anti-pemecahan paket
  v_capex := a.harga_po * r.jumlah + coalesce(r.biaya_instalasi, 0);
  select coalesce(sum(a2.harga_po * x.jumlah + coalesce(x.biaya_instalasi,0)),0), count(*) into v_gabung, v_n_gabung
    from kso.rencana_kso x join kso.alat a2 on a2.kode = x.alat_kode
   where x.id <> r.id and x.am_id = r.am_id and x.faskes_id = r.faskes_id
     and x.status not in ('DRAFT','DITOLAK_HOD','DITOLAK_DIREKSI','KALAH')
     and x.diajukan_at >= coalesce(r.diajukan_at, now()) - (kso.param('anti_pecah_hari') || ' days')::interval;
  update kso.rencana_kso set pecah_paket = (v_n_gabung > 0) where id = p_id;
  g_status := case when v_capex + v_gabung > kso.param('capex_maks') then 'merah'
                    when r.biaya_instalasi is null
                         and (v_capex + v_gabung) * (1 + kso.param('instalasi_cadangan_persen')/100) > kso.param('capex_maks') then 'belum'
                    else 'hijau' end;
  g_nilai  := kso.rp(v_capex)
              || case when r.biaya_instalasi is null then ' (instalasi belum diisi)' else '' end
              || case when v_n_gabung > 0
                      then ' + ' || v_n_gabung || ' usulan lain ke faskes ini dalam ' || kso.param('anti_pecah_hari') || ' hari = ' || kso.rp(v_capex + v_gabung)
                      else '' end;
  insert into kso.gerbang_hasil values (p_id, 1, 'Capex paket ≤ ' || kso.rp(kso.param('capex_maks')), g_status, g_nilai);

  -- 2. harga per test ≥ daftar standar
  if p_mode_hari_ini or k.harga_standar_per_test is null then
    g_status := 'belum'; g_nilai := 'Daftar harga standar belum ada di OS';
  elsif r.harga_per_test is null then
    g_status := 'belum'; g_nilai := 'Harga per test belum diisi';
  else
    g_status := case when r.harga_per_test >= k.harga_standar_per_test then 'hijau' else 'merah' end;
    g_nilai  := kso.rp(r.harga_per_test) || ' vs daftar ' || kso.rp(k.harga_standar_per_test);
  end if;
  insert into kso.gerbang_hasil values (p_id, 2, 'Harga per test ≥ daftar standar', g_status, g_nilai);

  -- 3. coverage cabang + teknisi tersertifikasi
  if p_mode_hari_ini then g_status := 'belum'; g_nilai := 'Register teknisi belum ada di OS';
  elsif f.cabang is null then g_status := 'merah'; g_nilai := 'Di luar coverage cabang';
  else
    v_tek := exists (select 1 from kso.cabang_teknisi t where t.cabang = f.cabang and t.kategori = a.kategori);
    g_status := case when v_tek then 'hijau' else 'merah' end;
    g_nilai  := 'Cabang ' || f.cabang || ' · ' || case when v_tek then 'teknisi ' else 'tidak ada teknisi ' end || lower(k.label);
  end if;
  insert into kso.gerbang_hasil values (p_id, 3, 'Coverage + teknisi tersertifikasi', g_status, g_nilai);

  -- 4. unit baru (status dari master aset OS; AM tidak mengisi)
  if p_mode_hari_ini or r.unit_status is null then g_status := 'belum'; g_nilai := 'Status unit belum ada di OS';
  else g_status := case when r.unit_status = 'baru' then 'hijau' else 'merah' end;
       g_nilai  := 'Unit ' || replace(r.unit_status::text,'_','-');
  end if;
  insert into kso.gerbang_hasil values (p_id, 4, 'Unit baru dari PO', g_status, g_nilai);

  -- 5. piutang faskes (seluruh tagihan faskes, bukan KSO ini saja)
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

  -- 6. tenor sejak serah terima
  if p_mode_hari_ini or r.tenor_bulan is null then g_status := 'belum'; g_nilai := 'Tenor belum diisi';
  else g_status := case when r.tenor_bulan <= kso.param('tenor_maks_bulan') then 'hijau' else 'merah' end;
       g_nilai  := r.tenor_bulan || ' bulan sejak serah terima';
  end if;
  insert into kso.gerbang_hasil values (p_id, 6, 'Tenor ≤ ' || kso.param('tenor_maks_bulan') || ' bulan', g_status, g_nilai);

  -- 7. nol klausul khusus
  select string_agg(kk.label, ', ' order by kk.urut) into v_kl
    from kso.rencana_klausul rk join kso.klausul_khusus kk on kk.kode = rk.klausul_kode where rk.rencana_id = p_id;
  insert into kso.gerbang_hasil values (p_id, 7, 'Nol klausul khusus',
    (case when v_kl is null then 'hijau' else 'merah' end)::kso.gerbang_status, coalesce(v_kl,'Tidak ada'));

  return query select g.no, g.nama, g.status, g.nilai from kso.gerbang_hasil g where g.rencana_id = p_id order by g.no;
end $$;

-- ---------- routing HOD ----------
-- security definer: dipakai juga di aturan akses (RLS); tanpa ini aturan memanggil dirinya sendiri tanpa henti
create or replace function kso.hod_untuk(p_id bigint) returns table (hod_id text, jenis kso.hod_jenis)
language sql stable security definer set search_path = kso, public as $$
  select h.id, h.jenis from kso.rencana_kso r
    join kso.alat a on a.kode = r.alat_kode join kso.kategori k on k.kode = a.kategori
    join kso.faskes f on f.id = r.faskes_id join kso.am m on m.id = r.am_id
    join kso.cabang c on c.nama = coalesce(f.cabang, m.cabang)        -- luar coverage → wilayah AM
    join kso.hod h on (h.jenis = 'bisnis' and h.cakupan = k.lini) or (h.jenis = 'area' and h.cakupan = c.wilayah)
   where r.id = p_id $$;

-- ---------- AI WhatsApp: buat draft dari pesan AM ----------
-- Parameter tanpa nilai = NULL. AI tidak boleh mengisi kolom yang tidak diucapkan AM,
-- dan fungsi ini tidak boleh mengisinya diam-diam lewat nilai bawaan.
-- p_pendukung: [{"nama":"…","tipe":"kepala_instalasi","sip":["F01"],"tanggal":"2026-10-10","cara":"kunjungan"}]
create or replace function kso.buat_draft(
  p_am text, p_faskes text, p_alat text, p_jumlah int, p_volume int, p_sumber text,
  p_harga numeric, p_unit kso.unit_status default null, p_tenor int default null,
  p_klausul text[] default '{}', p_pendukung jsonb default '[]', p_wa_thread text default null,
  p_lead kso.lead_asal default null, p_biaya_instalasi numeric default null)
returns bigint language plpgsql as $$
declare v_id bigint; x jsonb;
begin
  insert into kso.rencana_kso (am_id, faskes_id, alat_kode, jumlah, volume_estimasi, volume_sumber, harga_per_test,
                               unit_status, tenor_bulan, wa_thread_id, lead_asal, biaya_instalasi)
  values (p_am, p_faskes, p_alat, coalesce(p_jumlah,1), p_volume, p_sumber, p_harga, p_unit, p_tenor, p_wa_thread, p_lead, p_biaya_instalasi)
  returning id into v_id;
  insert into kso.rencana_klausul select v_id, unnest(coalesce(p_klausul,'{}'));
  for x in select * from jsonb_array_elements(coalesce(p_pendukung,'[]')) loop
    insert into kso.rencana_pendukung (rencana_id, nama, tipe, sip_faskes, kontak_terakhir_tanggal, kontak_terakhir_cara)
    values (v_id, x->>'nama', (x->>'tipe')::kso.pendukung_tipe,
            case when x ? 'sip' then array(select jsonb_array_elements_text(x->'sip')) end,
            (x->>'tanggal')::date, (x->>'cara')::kso.kontak_cara);
  end loop;
  perform kso.hitung_gerbang(v_id);      -- AM melihat hasil gerbang SEBELUM membalas "kirim"
  return v_id;
end $$;

-- ---------- AM: ajukan (bot WA, saat AM membalas "kirim") ----------
create or replace function kso.ajukan(p_id bigint, p_oleh text default 'ai_wa')
returns kso.jalur language plpgsql as $$
declare r kso.rencana_kso; v_kurang text[] := '{}'; v_merah int; v_alasan text; v_hod int; g kso.grup_mitra;
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

  update kso.rencana_kso set diajukan_at = now(), alasan_forum = null,
         nomor = coalesce(nomor, 'KSO-' || to_char(kso.hari_ini(),'YYYY') || '-' || lpad(id::text,4,'0'))
   where id = p_id;
  perform kso.ubah_status(p_id, 'DIAJUKAN', p_oleh);
  perform kso.hitung_gerbang(p_id);
  select count(*) into v_merah from kso.gerbang_hasil where rencana_id = p_id and status <> 'hijau';

  -- aturan di luar tujuh gerbang yang tetap memaksa forum (SK Pasal 14 dan 16)
  select gm.* into g from kso.faskes f join kso.grup_mitra gm on gm.grup = f.grup where f.id = r.faskes_id;
  if g.grup is not null and coalesce(g.rating_terburuk,1) >= 4 then
    v_alasan := 'Grup ' || g.grup || ' punya KSO rating ' || g.rating_terburuk || ' — dibekukan, wajib forum (SK Pasal 14)';
  elsif g.grup is not null and g.pks_lengkap is false then
    v_alasan := 'Grup ' || g.grup || ' masih punya KSO tanpa PKS bertanda tangan (SK Pasal 16)';
  elsif g.grup is not null and (g.rating_terburuk is null or g.pks_lengkap is null) then
    v_alasan := 'Status grup ' || g.grup || ' belum diketahui — rating atau kelengkapan PKS kosong';
  end if;
  select count(*) into v_hod from kso.hod_untuk(p_id);
  if v_alasan is null and v_hod < 2 then v_alasan := 'Routing HOD tidak lengkap (' || v_hod || ' dari 2 kursi)'; end if;

  if v_merah = 0 and v_alasan is null then
    update kso.rencana_kso set jalur = 'CEPAT' where id = p_id; perform kso.ubah_status(p_id, 'JALUR_CEPAT', 'mesin_gerbang');
    return 'CEPAT';
  end if;
  update kso.rencana_kso set jalur = 'FORUM', alasan_forum = v_alasan where id = p_id;
  perform kso.ubah_status(p_id, 'JALUR_FORUM', 'mesin_gerbang');
  return 'FORUM';
end $$;

-- ---------- mandat otomatis untuk jalur cepat ----------
create or replace function kso.mandat_otomatis(p_id bigint) returns void language plpgsql as $$
declare r kso.rencana_kso; a kso.alat; k kso.kategori;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into a from kso.alat where kode = r.alat_kode;
  select * into k from kso.kategori where kode = a.kategori;
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, tenor_maks_bulan, capex_maks, volume_minimum,
                          klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, k.harga_standar_per_test, greatest(r.harga_per_test, k.harga_standar_per_test), r.tenor_bulan,
          a.harga_po * r.jumlah + coalesce(r.biaya_instalasi,0), floor(r.volume_estimasi * kso.param('volume_minimum_rasio')),
          array(select kode from kso.klausul_khusus where kode in ('eksklusivitas','jaminan_volume','alat_jatuh')),
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'otomatis')
  on conflict (rencana_id) do nothing;
end $$;

-- ---------- HOD: tab "Minta Putusan" (jalur cepat) ----------
create or replace function kso.putus_hod(p_id bigint, p_hod text, p_keputusan text, p_catatan text default null)
returns kso.status_rencana language plpgsql as $$
declare v_status kso.status_rencana; v_setuju int; v_tolak int; v_n int; v_wajib int;
begin
  select status into v_status from kso.rencana_kso where id = p_id for update;
  if v_status <> 'JALUR_CEPAT' then raise exception 'BUKAN_JALUR_CEPAT: status %', v_status; end if;
  if not exists (select 1 from kso.hod_untuk(p_id) h where h.hod_id = p_hod) then
    raise exception 'HOD_TIDAK_BERWENANG: % untuk rencana %', p_hod, p_id; end if;
  insert into kso.pendapat_hod (rencana_id, hod_id, jenis, keputusan, catatan)
  values (p_id, p_hod, 'putusan', p_keputusan, p_catatan)
  on conflict (rencana_id, hod_id, jenis) do update set keputusan = excluded.keputusan, catatan = excluded.catatan, at = now();

  if p_keputusan = 'naikkan' then perform kso.ubah_status(p_id, 'JALUR_FORUM', p_hod); return 'JALUR_FORUM'; end if;
  select count(*) into v_wajib from kso.hod_untuk(p_id);                -- jumlah kursi dari routing, bukan angka tetap
  select count(*) filter (where p.keputusan='setuju'), count(*) filter (where p.keputusan='tolak'), count(*)
    into v_setuju, v_tolak, v_n
    from kso.pendapat_hod p join kso.hod_untuk(p_id) h on h.hod_id = p.hod_id
   where p.rencana_id = p_id and p.jenis = 'putusan';
  if v_setuju > 0 and v_tolak > 0 then                         -- dua kursi bertentangan → forum
    perform kso.ubah_status(p_id, 'JALUR_FORUM', 'aturan_pertentangan'); return 'JALUR_FORUM';
  elsif v_n >= v_wajib and v_setuju = v_n then
    perform kso.ubah_status(p_id, 'DIPUTUS_HOD', p_hod); perform kso.mandat_otomatis(p_id); return 'DIPUTUS_HOD';
  elsif v_n >= v_wajib and v_tolak = v_n then
    perform kso.ubah_status(p_id, 'DITOLAK_HOD', p_hod); return 'DITOLAK_HOD';
  end if;
  return 'JALUR_CEPAT';                                         -- menunggu kursi lain
end $$;

-- job terjadwal: HOD lewat batas di jalur cepat = dianggap setuju (dicatat, dilaporkan di forum)
-- Rujukan memakai jam; produksi: ganti dengan hitungan hari kerja WIB.
create or replace function kso.proses_lewat_batas_hod() returns int language plpgsql as $$
declare x record; v_n int := 0;
begin
  for x in select r.id, h.hod_id from kso.rencana_kso r cross join lateral kso.hod_untuk(r.id) h
            where r.status = 'JALUR_CEPAT'
              and r.diajukan_at < now() - (kso.param('batas_hod_jam_cepat') || ' hours')::interval
              and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = r.id and p.hod_id = h.hod_id and p.jenis = 'putusan')
  loop
    continue when (select status from kso.rencana_kso where id = x.id) <> 'JALUR_CEPAT';
    perform kso.putus_hod(x.id, x.hod_id, 'setuju', 'Lewat batas waktu — dianggap setuju');
    update kso.pendapat_hod set dianggap_setuju = true where rencana_id = x.id and hod_id = x.hod_id and jenis = 'putusan';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------- HOD: tab "Minta Pendapat" (jalur forum) — berpendapat, tidak memutus ----------
create or replace function kso.simpan_pendapat_hod(p_id bigint, p_hod text, p_catatan text)
returns void language plpgsql as $$
begin
  if (select status from kso.rencana_kso where id = p_id) not in ('JALUR_FORUM','DIAGENDAKAN') then
    raise exception 'BUKAN_JALUR_FORUM'; end if;
  if not exists (select 1 from kso.hod_untuk(p_id) h where h.hod_id = p_hod) then
    raise exception 'HOD_TIDAK_BERWENANG: % untuk rencana %', p_hod, p_id; end if;
  insert into kso.pendapat_hod (rencana_id, hod_id, jenis, keputusan, catatan)
  values (p_id, p_hod, 'pendapat', null, p_catatan)
  on conflict (rencana_id, hod_id, jenis) do update set catatan = excluded.catatan, at = now();
end $$;

-- ---------- Agenda: terbit pukul 14.00 pada hari forum, tepat setelah batas pengiriman ----------
-- p_batas: rencana yang masuk jalur forum sesudah jam ini menunggu forum berikutnya.
create or replace function kso.susun_agenda(p_tanggal date, p_batas timestamptz default null) returns bigint
language plpgsql as $$
declare v_forum bigint; v_prev timestamptz; v_batas timestamptz; v_n int := 0; x record;
begin
  if extract(isodow from p_tanggal) not in (2,4) then raise exception 'FORUM_HANYA_SELASA_KAMIS: %', p_tanggal; end if;
  v_batas := coalesce(p_batas, kso.jam_wib(p_tanggal, '14:00'));
  select max(diterbitkan_at) into v_prev from kso.forum where tanggal < p_tanggal;
  insert into kso.forum (tanggal) values (p_tanggal) returning id into v_forum;

  for x in select r.id from kso.rencana_kso r
            where r.status = 'JALUR_FORUM'
              and (select max(s.at) from kso.riwayat_status s where s.rencana_id = r.id and s.ke = 'JALUR_FORUM') <= v_batas
            order by exists (select 1 from kso.riwayat_status s where s.rencana_id = r.id and s.dari = 'DITAHAN') desc,
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
   where s.ke in ('DIPUTUS_HOD','DITOLAK_HOD')
     and s.at > coalesce(v_prev, '-infinity'::timestamptz) and s.at <= clock_timestamp()
  on conflict do nothing;

  if v_n = 0 then update kso.forum set mode = 'portofolio' where id = v_forum; end if;  -- forum tidak pernah batal
  return v_forum;
end $$;

-- ---------- Komite: rumuskan usulan kepada Direksi (bukan memutus) ----------
create or replace function kso.usulkan(p_id bigint, p_forum bigint, p_usulan kso.usulan_komite,
  p_syarat jsonb default null, p_data_kurang text default null, p_pemilik text default null,
  p_tanggal_kembali date default null, p_alasan text default null, p_mandat_usulan jsonb default null)
returns void language plpgsql as $$
begin
  if (select status from kso.rencana_kso where id = p_id) <> 'DIAGENDAKAN' then raise exception 'BELUM_DIAGENDAKAN'; end if;
  insert into kso.usulan_komite_catatan (rencana_id, forum_id, usulan, syarat, mandat_usulan, data_kurang, pemilik, tanggal_kembali, alasan)
  values (p_id, p_forum, p_usulan, p_syarat, p_mandat_usulan, p_data_kurang, p_pemilik, p_tanggal_kembali, p_alasan);
  perform kso.ubah_status(p_id, p_usulan::text::kso.status_rencana, 'komite');
end $$;

-- ---------- Komite: tarik putusan jalur cepat / mandat kedaluwarsa kembali ke forum (SK Pasal 7 ayat 4) ----------
create or replace function kso.tarik_ke_forum(p_id bigint, p_alasan text, p_oleh text default 'komite')
returns void language plpgsql as $$
begin
  perform kso.ubah_status(p_id, 'JALUR_FORUM', p_oleh);
  update kso.rencana_kso set alasan_forum = p_alasan where id = p_id;
end $$;

-- ---------- Direksi: memutus + menetapkan mandat ----------
create or replace function kso.putus_direksi(p_id bigint, p_putusan kso.putusan_direksi, p_catatan text default null,
  p_lantai numeric default null, p_target numeric default null, p_tenor_maks int default null,
  p_capex_maks numeric default null, p_volume_min int default null, p_klausul_dilarang text[] default '{}')
returns kso.status_rencana language plpgsql as $$
declare v_status kso.status_rencana;
begin
  select status into v_status from kso.rencana_kso where id = p_id for update;
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
  insert into kso.mandat (rencana_id, harga_lantai, harga_target, tenor_maks_bulan, capex_maks, volume_minimum,
                          klausul_dilarang, berlaku_sampai, sumber)
  values (p_id, p_lantai, p_target, p_tenor_maks, p_capex_maks, p_volume_min, p_klausul_dilarang,
          kso.hari_ini() + kso.param('mandat_berlaku_hari')::int, 'direksi')
  on conflict (rencana_id) do update set harga_lantai = excluded.harga_lantai, harga_target = excluded.harga_target,
     tenor_maks_bulan = excluded.tenor_maks_bulan, capex_maks = excluded.capex_maks, volume_minimum = excluded.volume_minimum,
     klausul_dilarang = excluded.klausul_dilarang, berlaku_sampai = excluded.berlaku_sampai, sumber = 'direksi', terbit_at = now();
  perform kso.ubah_status(p_id, 'MANDAT_TERBIT', 'direksi'); return 'MANDAT_TERBIT';
end $$;

-- ---------- Admin sales: terbitkan penawaran — hanya bila ada mandat ----------
create or replace function kso.terbitkan_penawaran(p_id bigint, p_harga numeric, p_oleh text default 'admin_sales')
returns void language plpgsql as $$
declare m kso.mandat;
begin
  select * into m from kso.mandat where rencana_id = p_id;
  if m is null then raise exception 'TIDAK_ADA_MANDAT' using hint = 'Tombol terbitkan tidak tersedia tanpa mandat.'; end if;
  if m.berlaku_sampai < kso.hari_ini() then raise exception 'MANDAT_KEDALUWARSA: %', m.berlaku_sampai; end if;
  if p_harga < m.harga_lantai then raise exception 'KELUAR_MANDAT: % di bawah lantai %', kso.rp(p_harga), kso.rp(m.harga_lantai); end if;
  perform kso.ubah_status(p_id, 'PENAWARAN_TERBIT', p_oleh);
end $$;

-- ---------- pipeline: dipanggil tiap revisi harga di tahap negosiasi ----------
create or replace function kso.cek_negosiasi(p_id bigint, p_harga numeric, p_volume int)
returns text language plpgsql stable as $$
declare m kso.mandat;
begin
  select * into m from kso.mandat where rencana_id = p_id;
  if m is null then return 'TERKUNCI: tidak ada mandat'; end if;
  if m.berlaku_sampai < kso.hari_ini() then return 'TERKUNCI: mandat kedaluwarsa ' || m.berlaku_sampai; end if;
  if p_harga < m.harga_lantai then return 'TERKUNCI: ' || kso.rp(p_harga) || ' di bawah lantai ' || kso.rp(m.harga_lantai) || ' — AM kirim "minta kelonggaran"'; end if;
  if m.volume_minimum is not null and p_volume < m.volume_minimum then
    return 'TERKUNCI: volume ' || p_volume || ' di bawah asumsi minimum ' || m.volume_minimum; end if;
  return 'BEBAS: AM jalan sendiri';
end $$;

-- AM minta kelonggaran → kembali ke antrean forum berikutnya
create or replace function kso.minta_kelonggaran(p_id bigint, p_alasan text, p_oleh text default 'ai_wa')
returns void language plpgsql as $$
begin
  if (select status from kso.rencana_kso where id = p_id) <> 'PENAWARAN_TERBIT' then
    raise exception 'BUKAN_TAHAP_NEGOSIASI' using hint = 'Minta kelonggaran hanya untuk penawaran yang sudah terbit.'; end if;
  perform kso.ubah_status(p_id, 'JALUR_FORUM', p_oleh);
  update kso.rencana_kso set alasan_forum = 'Minta kelonggaran: ' || p_alasan,
         risiko_catatan = coalesce(risiko_catatan || E'\n','') || 'Minta kelonggaran: ' || p_alasan where id = p_id;
end $$;

-- ---------- ujung rantai: PKS, kalah, serah terima ----------
create or replace function kso.catat_pks(p_id bigint, p_harga_deal numeric, p_oleh text default 'direksi')
returns void language plpgsql as $$
declare m kso.mandat;
begin
  select * into m from kso.mandat where rencana_id = p_id;
  if m.berlaku_sampai is not null and m.berlaku_sampai < kso.hari_ini() then raise exception 'MANDAT_KEDALUWARSA: %', m.berlaku_sampai; end if;
  if m.harga_lantai is not null and p_harga_deal < m.harga_lantai then
    raise exception 'KELUAR_MANDAT: harga deal % di bawah lantai %', kso.rp(p_harga_deal), kso.rp(m.harga_lantai); end if;
  update kso.rencana_kso set harga_deal = p_harga_deal where id = p_id;
  perform kso.ubah_status(p_id, 'PKS_TTD', p_oleh);
end $$;

create or replace function kso.catat_kalah(p_id bigint, p_alasan text, p_oleh text default 'ai_wa')
returns void language plpgsql as $$
begin
  perform kso.ubah_status(p_id, 'KALAH', p_oleh);
  update kso.rencana_kso set risiko_catatan = coalesce(risiko_catatan || E'\n','') || 'Kalah: ' || p_alasan where id = p_id;
end $$;

-- serah terima → TERPASANG, dan jadwal verifikasi volume bulan ke-6 langsung dibuat
create or replace function kso.serah_terima(p_id bigint, p_nomor_seri text, p_tanggal date default null, p_oleh text default 'teknik')
returns void language plpgsql as $$
begin
  if coalesce(btrim(p_nomor_seri),'') = '' then raise exception 'NOMOR_SERI_WAJIB' using hint = 'Serah terima tanpa nomor seri tidak bisa dicatat.'; end if;
  update kso.rencana_kso set nomor_seri = p_nomor_seri where id = p_id;
  perform kso.ubah_status(p_id, 'TERPASANG', p_oleh);
  insert into kso.verifikasi_bulan6 (rencana_id, serah_terima, volume_dijanjikan)
  select p_id, coalesce(p_tanggal, kso.hari_ini()), volume_estimasi from kso.rencana_kso where id = p_id
  on conflict (rencana_id) do nothing;
end $$;
