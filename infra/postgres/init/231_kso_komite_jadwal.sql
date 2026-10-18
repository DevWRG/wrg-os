-- 231 — F170 Komite KSO Tahap 5: jadwal otomatis (agenda 14.00, lewat batas HOD) + batas hari kerja
--
-- 1. Batas putusan HOD jalur cepat = 1 HARI KERJA (spesifikasi "maks. 1 hari kerja"), bukan 24 jam
--    seperti rujukan: Sabtu/Minggu & libur nasional (public.master_holiday, F14) dilewati. Usulan
--    Jumat sore → batas Senin jam yang sama, bukan Sabtu. Dipakai di proses_lewat_batas_hod DAN di
--    kolom batas antrean HOD (v_antrean), supaya yang dilihat HOD = yang ditegakkan mesin.
-- 2. Akun mesin 'job-jadwal' (peran sekretaris) + pembungkus job yang IDEMPOTEN: scheduler API yang
--    jalan dua kali (restart tepat 14.00) tidak membuat forum ganda / memproses ganda.
-- 3. kso.notifikasi_terkirim: kunci pesan yang sudah dikirim → pesan WA tak terkirim dua kali.

set search_path = kso, public;

insert into kso.parameter values ('batas_hod_hari_kerja', 1, 'Batas putusan HOD jalur cepat (HARI KERJA; Sabtu/Minggu & master_holiday dilewati)')
on conflict (kunci) do nothing;
update kso.parameter set catatan = 'TIDAK DIPAKAI sejak migrasi 231 — diganti batas_hod_hari_kerja' where kunci = 'batas_hod_jam_cepat';

-- n hari kerja sesudah p_ts, jam WIB yang sama. Hari kerja = Senin–Jumat dan bukan master_holiday.
create or replace function kso.tambah_hari_kerja(p_ts timestamptz, p_n int) returns timestamptz
language plpgsql stable security definer set search_path = kso, public as $$
declare d date := (p_ts at time zone 'Asia/Jakarta')::date; jam time := (p_ts at time zone 'Asia/Jakarta')::time; k int := 0;
begin
  while k < p_n loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists (select 1 from public.master_holiday h where h.tanggal = d) then k := k + 1; end if;
  end loop;
  return (d + jam) at time zone 'Asia/Jakarta';
end $$;

create or replace function kso.batas_putusan_hod(p_diajukan timestamptz) returns timestamptz
language sql stable security definer set search_path = kso, public as $$
  select kso.tambah_hari_kerja(p_diajukan, kso.param('batas_hod_hari_kerja')::int) $$;

create or replace function kso.proses_lewat_batas_hod() returns int language plpgsql as $$
declare x record; v_n int := 0;
begin
  for x in select r.id, h.hod_id from kso.rencana_kso r cross join lateral kso.hod_untuk(r.id) h
            where r.status = 'JALUR_CEPAT'
              and kso.batas_putusan_hod(r.diajukan_at) < now()
              and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = r.id and p.hod_id = h.hod_id and p.jenis = 'putusan')
  loop
    continue when (select status from kso.rencana_kso where id = x.id) <> 'JALUR_CEPAT';
    perform kso.putus_hod(x.id, x.hod_id, 'setuju', 'Lewat batas 1 hari kerja — dianggap setuju');
    update kso.pendapat_hod set dianggap_setuju = true where rencana_id = x.id and hod_id = x.hod_id and jenis = 'putusan';
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- v_antrean: sama dengan 226, kecuali batas HOD = hari kerja
create or replace view kso.v_antrean as
-- AM: Rencana Saya (baca saja)
select 'AM · Rencana Saya'::text as antrean, v.am_id as pemilik_id, v.id as rencana_id, v.nomor, v.status::text, v.faskes_nama,
       v.alat_nama, v.capex, v.diubah_at as sejak, null::timestamptz as batas
  from kso.v_rencana v where v.status not in ('TERPASANG','KALAH','DITOLAK_HOD','DITOLAK_DIREKSI')
union all
-- HOD: Minta Putusan (jalur cepat) — memutus
select 'HOD · Minta Putusan', h.hod_id, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diajukan_at, kso.batas_putusan_hod(v.diajukan_at)
  from kso.v_rencana v cross join lateral kso.hod_untuk(v.id) h
 where v.status = 'JALUR_CEPAT'
   and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = v.id and p.hod_id = h.hod_id and p.jenis = 'putusan')
union all
-- HOD: Minta Pendapat (jalur forum) — berpendapat
select 'HOD · Minta Pendapat', h.hod_id, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, null
  from kso.v_rencana v cross join lateral kso.hod_untuk(v.id) h
 where v.status in ('JALUR_FORUM','DIAGENDAKAN')
   and not exists (select 1 from kso.pendapat_hod p where p.rencana_id = v.id and p.hod_id = h.hod_id and p.jenis = 'pendapat')
union all
-- Komite: Agenda Forum
select 'Komite · Agenda Forum', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex, v.diubah_at, null
  from kso.v_rencana v where v.status = 'DIAGENDAKAN'
union all
-- Direksi: Putusan (termasuk yang diusulkan ditolak — Direksi tetap yang memutus)
select 'Direksi · Putusan', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib((v.diubah_at at time zone 'Asia/Jakarta')::date, '22:00')   -- 22.00 WIB, bukan jam server
  from kso.v_rencana v where v.status in ('DIREKOMENDASIKAN','DIREKOMENDASIKAN_BERSYARAT','TIDAK_DIREKOMENDASIKAN')
union all
-- Admin Sales: Terbitkan Penawaran — hanya yang punya mandat yang masih berlaku
select 'Admin Sales · Terbitkan Penawaran', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, kso.jam_wib(md.berlaku_sampai, '23:59')
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status in ('DIPUTUS_HOD','MANDAT_TERBIT') and md.berlaku_sampai >= kso.hari_ini()
union all
-- Komite: mandat kedaluwarsa sebelum penawaran terbit → tarik kembali ke forum
select 'Komite · Mandat Kedaluwarsa', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex,
       v.diubah_at, null
  from kso.v_rencana v join kso.mandat md on md.rencana_id = v.id
 where v.status in ('DIPUTUS_HOD','MANDAT_TERBIT') and md.berlaku_sampai < kso.hari_ini()
union all
-- Teknik: Jadwal Pasang
select 'Teknik · Jadwal Pasang', null, v.id, v.nomor, v.status::text, v.faskes_nama, v.alat_nama, v.capex, v.diubah_at, null
  from kso.v_rencana v where v.status = 'PKS_TTD';
alter view kso.v_antrean set (security_invoker = on);

-- ---------- akun mesin + pembungkus job ----------
insert into kso.pengguna (user_id, peran, ref_id) values ('job-jadwal', 'sekretaris', null) on conflict (user_id) do nothing;

create or replace function kso.app_job_susun_agenda(p_tanggal date) returns bigint
language plpgsql security definer set search_path = kso, public as $$
declare v bigint;
begin
  perform kso.wajib_peran('sekretaris');
  select id into v from kso.forum where tanggal = p_tanggal;
  if v is not null then return v; end if;          -- sudah terbit: jangan susun ulang
  return kso.susun_agenda(p_tanggal);
end $$;

create or replace function kso.app_job_lewat_batas_hod() returns int
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('sekretaris'); return kso.proses_lewat_batas_hod(); end $$;

create table if not exists kso.notifikasi_terkirim (
  kunci  text primary key,          -- mis. 'agenda:2026-10-20', 'hod-putusan:12:yogi'
  jenis  text not null,
  at     timestamptz not null default now()
);
alter table kso.notifikasi_terkirim enable row level security;
revoke all on kso.notifikasi_terkirim from public;

-- true = kunci baru (boleh kirim); false = sudah pernah → jangan kirim lagi
create or replace function kso.app_job_tandai_notif(p_kunci text, p_jenis text) returns boolean
language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('sekretaris', 'bot_wa');
  insert into kso.notifikasi_terkirim (kunci, jenis) values (p_kunci, p_jenis) on conflict do nothing;
  return found;
end $$;

-- batalkan tanda bila pengiriman gagal, supaya percobaan berikutnya boleh mengirim
create or replace function kso.app_job_batal_notif(p_kunci text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('sekretaris', 'bot_wa'); delete from kso.notifikasi_terkirim where kunci = p_kunci; end $$;

revoke execute on function kso.tambah_hari_kerja(timestamptz, int), kso.batas_putusan_hod(timestamptz),
  kso.app_job_susun_agenda(date), kso.app_job_lewat_batas_hod(), kso.app_job_tandai_notif(text, text), kso.app_job_batal_notif(text) from public;
grant execute on function kso.tambah_hari_kerja(timestamptz, int), kso.batas_putusan_hod(timestamptz),
  kso.app_job_susun_agenda(date), kso.app_job_lewat_batas_hod(), kso.app_job_tandai_notif(text, text), kso.app_job_batal_notif(text) to wrg_app;

-- ---------- verifikasi bulan ke-6 (tiap tanggal 6) ----------
-- Volume aktual dari laporan tes per faskes (public.kso_tes_faskes_v, F169: Accurate PER_TEST +
-- sheet). Jenis tes di sana lebih rinci dari kategori KSO → peta alat → jenis tes (DATA, bukan kode).
create table if not exists kso.alat_jenis_tes (
  alat_kode  text primary key,      -- kso.alat.kode
  jenis_tes  text not null          -- kso_tes_faskes_v.jenis
);
insert into kso.alat_jenis_tes values
  ('Z3','Hematology 3Diff'), ('Z50','Hematology 5Diff'), ('Z52','Hematology 5Diff'),
  ('EXZ6000','Hematology 5Diff'), ('EXZ8000','Hematology 5Diff'),
  ('EXC200','Kimia Klinik'), ('EXC400','Kimia Klinik'), ('DNX6','Elektrolite')
on conflict (alat_kode) do nothing;
alter table kso.alat_jenis_tes enable row level security;
drop policy if exists baca on kso.alat_jenis_tes;
create policy baca on kso.alat_jenis_tes for select to wrg_app using (kso.peran_saya() is not null);
grant select on kso.alat_jenis_tes to wrg_app;

-- Isi volume_aktual = jumlah tes faskes itu, jenis alat itu, pada BULAN KE-6 sesudah serah terima.
-- Konservatif: hanya bila faskes TAK punya tes jenis yang sama 3 bulan sebelum serah terima — kalau
-- ada, tes alat lama tercampur dan angka "aktual" palsu; baris dibiarkan kosong → verifikasi manual.
-- Bulan ke-6 yang laporannya belum masuk juga dibiarkan kosong (dicoba lagi bulan berikutnya).
create or replace function kso.isi_verifikasi_bulan6(p_hari_ini date) returns jsonb
language plpgsql security definer set search_path = kso, public as $$
declare x record; v_tes numeric; v_lama numeric; v_isi int := 0; v_manual text[] := '{}'; v_tunggu int := 0;
begin
  for x in select vb.rencana_id, vb.serah_terima, r.faskes_id, r.nomor, j.jenis_tes,
                  (date_trunc('month', vb.serah_terima) + interval '6 months')::date as bulan6
             from kso.verifikasi_bulan6 vb
             join kso.rencana_kso r on r.id = vb.rencana_id
             left join kso.alat_jenis_tes j on j.alat_kode = r.alat_kode
            where vb.volume_aktual is null
              and (date_trunc('month', vb.serah_terima) + interval '7 months')::date <= p_hari_ini  -- bulan ke-6 sudah lewat
  loop
    if x.jenis_tes is null then v_manual := v_manual || coalesce(x.nomor, x.rencana_id::text); continue; end if;
    select sum(jumlah_tes) into v_lama from public.kso_tes_faskes_v t
     where t.account_id::text = x.faskes_id and t.jenis = x.jenis_tes
       and t.periode >= (date_trunc('month', x.serah_terima) - interval '3 months') and t.periode < date_trunc('month', x.serah_terima);
    if coalesce(v_lama, 0) > 0 then v_manual := v_manual || coalesce(x.nomor, x.rencana_id::text); continue; end if;
    select sum(jumlah_tes) into v_tes from public.kso_tes_faskes_v t
     where t.account_id::text = x.faskes_id and t.jenis = x.jenis_tes and t.periode = x.bulan6;
    if v_tes is null then v_tunggu := v_tunggu + 1; continue; end if;
    update kso.verifikasi_bulan6 set volume_aktual = round(v_tes), diverifikasi_at = now() where rencana_id = x.rencana_id;
    v_isi := v_isi + 1;
  end loop;
  return jsonb_build_object('diisi', v_isi, 'menunggu_laporan', v_tunggu, 'verifikasi_manual', to_jsonb(v_manual));
end $$;

create or replace function kso.app_job_verifikasi_bulan6(p_hari_ini date) returns jsonb
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('sekretaris'); return kso.isi_verifikasi_bulan6(p_hari_ini); end $$;

revoke execute on function kso.isi_verifikasi_bulan6(date), kso.app_job_verifikasi_bulan6(date) from public;
grant execute on function kso.app_job_verifikasi_bulan6(date) to wrg_app;
