-- Uji otomatis. Jalankan setelah 001–004. Setiap baris "LULUS" = satu perilaku terbukti.
-- Sengaja dijalankan dalam zona UTC (seperti Supabase) supaya kesalahan zona waktu ketahuan.
\set ON_ERROR_STOP on
set timezone = 'UTC';
set search_path = kso, public;
create schema if not exists uji;
create or replace function uji.cek(p_nama text, p_benar boolean) returns void language plpgsql as $$
begin if not coalesce(p_benar, false) then raise exception 'GAGAL: %', p_nama; end if; raise notice 'LULUS  %', p_nama; end $$;
create or replace function uji.harus_gagal(p_nama text, p_sql text, p_pola text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then
    if sqlerrm ~* p_pola then raise notice 'LULUS  %  (ditolak: %)', p_nama, left(sqlerrm,70); return; end if;
    raise exception 'GAGAL: % — error lain: %', p_nama, sqlerrm; end;
  raise exception 'GAGAL: % — seharusnya ditolak', p_nama;
end $$;
create or replace function uji.pola(p_id bigint) returns text language sql as $$
  select string_agg(case status when 'hijau' then 'h' when 'merah' then 'm' else 'b' end,'' order by no) from kso.gerbang_hasil where rencana_id=p_id $$;
create table if not exists uji.id (k text primary key, v bigint);

do $$
declare a bigint; b bigint; c bigint; f4 bigint; f5 bigint; p1 bigint; p2 bigint; k bigint; q bigint; fr1 bigint; fr2 bigint; fr3 bigint; fx bigint;
  dk jsonb := '[{"nama":"dr. Rina SpPK","tipe":"kepala_instalasi","sip":["F01"],"tanggal":"2026-10-10","cara":"kunjungan"}]';
begin
  -- === tiga contoh deck ===
  a := kso.buat_draft('AM-01','F01','Z3',1,900,'data LIS 3 bulan terakhir, dikirim kepala lab',18500,'baru',36,'{}',dk);
  perform uji.cek('Contoh A: pola gerbang hhhhhhh sebelum dikirim', uji.pola(a)='hhhhhhh');
  perform uji.cek('Contoh A: jalur CEPAT', kso.ajukan(a)='CEPAT');
  b := kso.buat_draft('AM-02','F02','Z52',1,2400,'data LIS 3 bulan, ekspor dari sistem RS',12000,'baru',36,'{}',dk);
  perform uji.cek('Contoh B: jalur FORUM, merah hanya gerbang 1', kso.ajukan(b)='FORUM' and uji.pola(b)='mhhhhhh');
  c := kso.buat_draft('AM-03','F03','EXZ8000',1,1800,'catatan lisan pengadaan',95000,'baru',36,'{eksklusivitas,alat_jatuh}',dk);
  perform uji.cek('Contoh C: jalur FORUM, merah gerbang 1,5,7', kso.ajukan(c)='FORUM' and uji.pola(c)='mhhhmhm');

  -- === aturan intake: tidak ada kolom yang terisi diam-diam ===
  k := kso.buat_draft('AM-01','F01','Z3',1,900,'   ',18500,'baru',36,'{}',dk);
  perform uji.harus_gagal('Sumber volume kosong ditahan AI', format('select kso.ajukan(%s)',k), 'SUMBER_VOLUME_KOSONG');
  k := kso.buat_draft('AM-01','F01','Z3',1,900,'lisan',18500,'baru',36,'{}','[]');
  perform uji.harus_gagal('Tanpa pendukung tidak bisa dikirim', format('select kso.ajukan(%s)',k), 'KOLOM_WAJIB_KOSONG: pendukung');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',18500,'baru',null,'{}',dk);
  perform uji.cek('Tenor tidak diucapkan AM → tetap kosong, bukan 36', (select tenor_bulan is null from kso.rencana_kso where id=k));
  perform uji.harus_gagal('Tanpa tenor tidak bisa dikirim', format('select kso.ajukan(%s)',k), 'KOLOM_WAJIB_KOSONG: tenor_bulan');
  k := kso.buat_draft('AM-04','F06','Z3',1,900,'data',18500,null,36,'{}',dk);
  perform uji.cek('Status unit belum ada → gerbang 4 belum bisa dicek, bukan hijau', uji.pola(k)='hhhbhhh');
  perform uji.cek('Gerbang belum bisa dicek → jalur forum', kso.ajukan(k)='FORUM');

  -- === gerbang spesifik ===
  f4 := kso.buat_draft('AM-01','F04','Z3',1,900,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Piutang belum lewat tempo tapi 5× tagihan → gerbang 5 merah', uji.pola(f4)='hhhhmhh');
  f5 := kso.buat_draft('AM-04','F05','Z52',1,1500,'data LIS',12000,'baru',36,'{}',dk);
  perform uji.cek('Jember tanpa teknisi kimia → gerbang 1 dan 3 merah', uji.pola(f5)='mhmhhhh');
  k := kso.buat_draft('AM-01','F07','Z3',1,500,'lisan',18500,'baru',36,'{}',dk);
  perform uji.cek('Faskes luar coverage → gerbang 3 merah', substr(uji.pola(k),3,1)='m');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',18500,'eks_kso',48,'{}',dk);
  perform uji.cek('Unit eks-KSO dan tenor 48 → gerbang 4 dan 6 merah', uji.pola(k)='hhhmhmh');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',17000,'baru',36,'{}',dk);
  perform uji.cek('Harga di bawah daftar standar → gerbang 2 merah', uji.pola(k)='hmhhhhh');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',18500,'baru',36,'{}',dk,null,null,8000000);
  perform uji.cek('Instalasi ikut dihitung: Rp 52,8 jt + Rp 8 jt > Rp 60 jt → gerbang 1 merah', substr(uji.pola(k),1,1)='m');
  perform kso.hitung_gerbang(a, true);
  perform uji.cek('Mode data OS hari ini → gerbang 2–6 belum bisa dicek', uji.pola(a)='hbbbbbh');
  perform kso.hitung_gerbang(a, false);

  -- === aturan grup mitra (SK Pasal 14) ===
  insert into kso.grup_mitra values ('GRUP-X', 4, true);
  insert into kso.faskes (id,nama,cabang,grup,piutang_hari,piutang_nilai,tagihan_bulanan) values ('F09','RS Grup X — Surabaya','Surabaya','GRUP-X',10,10000000,10000000);
  k := kso.buat_draft('AM-02','F09','Z3',1,800,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Grup dengan KSO rating 4: tujuh gerbang hijau sebelum dikirim', uji.pola(k)='hhhhhhh');
  perform uji.cek('Grup dengan KSO rating 4: tetap masuk forum (SK Pasal 14)', kso.ajukan(k)='FORUM');
  perform uji.cek('Alasan forum di luar gerbang tercatat', (select alasan_forum like '%rating 4%' from kso.rencana_kso where id=k));
  insert into kso.grup_mitra values ('GRUP-Y', null, null);
  insert into kso.faskes (id,nama,cabang,grup,piutang_hari,piutang_nilai,tagihan_bulanan) values ('F10','RS Grup Y — Sidoarjo','Sidoarjo','GRUP-Y',10,10000000,10000000);
  k := kso.buat_draft('AM-02','F10','Z3',1,800,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Status grup belum diketahui → forum, bukan jalur cepat', kso.ajukan(k)='FORUM');
  k := kso.buat_draft('AM-03','F01','Z3',1,900,'data',18500,'baru',36,'{}',dk);
  perform uji.cek('Instalasi belum diisi tapi PO Rp 52,8 jt + cadangan 10% < Rp 60 jt → tetap hijau', substr(uji.pola(k),1,1)='h');
  k := kso.buat_draft('AM-03','F02','Z3',1,900,'data',18500,'baru',36,'{}',dk);
  update kso.alat set harga_po = 56000000 where kode = 'Z3'; perform kso.hitung_gerbang(k);
  perform uji.cek('Instalasi belum diisi dan PO + cadangan bisa melewati ambang → gerbang 1 belum bisa dicek', substr(uji.pola(k),1,1)='b');
  update kso.alat set harga_po = 52800000 where kode = 'Z3';

  -- === anti-pemecahan paket ===
  p1 := kso.buat_draft('AM-01','F08','Z3',1,700,'data',18500,'baru',36,'{}',dk);
  perform uji.cek('Pecahan pertama Rp 52,8 jt → jalur cepat', kso.ajukan(p1)='CEPAT');
  p2 := kso.buat_draft('AM-01','F08','Z3',1,700,'data',18500,'baru',36,'{}',dk);
  perform uji.cek('Pecahan kedua ke faskes sama < 30 hari → jalur forum', kso.ajukan(p2)='FORUM');
  perform uji.cek('Capex pecahan digabung jadi Rp 105,6 jt dan ditandai pecah paket',
                  (select nilai from kso.gerbang_hasil where rencana_id=p2 and no=1) like '%Rp 105,6 jt%'
                  and (select pecah_paket from kso.rencana_kso where id=p2));

  -- === jalur cepat: dua kursi HOD ===
  perform uji.harus_gagal('HOD Area Barat tidak berwenang untuk faskes Surabaya', format('select kso.putus_hod(%s,''HA-BAR'',''setuju'')',a), 'HOD_TIDAK_BERWENANG');
  perform uji.cek('Satu kursi setuju → masih menunggu kursi kedua', kso.putus_hod(a,'HB-IVD','setuju')='JALUR_CEPAT');
  perform uji.cek('Dua kursi setuju → DIPUTUS_HOD', kso.putus_hod(a,'HA-TIM','setuju')='DIPUTUS_HOD');
  perform uji.cek('Mandat otomatis: lantai = daftar standar Rp 18.500, sumber otomatis',
                  (select harga_lantai=18500 and sumber='otomatis' and volume_minimum=720 from kso.mandat where rencana_id=a));
  perform kso.putus_hod(p1,'HB-IVD','setuju');
  perform uji.cek('Dua kursi bertentangan → naik otomatis ke forum', kso.putus_hod(p1,'HA-TIM','tolak')='JALUR_FORUM');
  perform kso.simpan_pendapat_hod(p1,'HB-IVD','Setuju, volume wajar');
  perform uji.cek('Putusan dan pendapat HOD tersimpan terpisah — jejak pertentangan tidak hilang',
                  (select count(*)=2 from kso.pendapat_hod where rencana_id=p1 and hod_id='HB-IVD'));
  perform uji.harus_gagal('HOD di luar routing tidak bisa berpendapat', format('select kso.simpan_pendapat_hod(%s,''HA-BAR'',''x'')',b), 'HOD_TIDAK_BERWENANG');

  -- === penawaran & negosiasi ===
  perform uji.harus_gagal('Admin sales tidak bisa terbit di bawah lantai', format('select kso.terbitkan_penawaran(%s,18000)',a), 'KELUAR_MANDAT');
  perform uji.harus_gagal('Admin sales tidak bisa terbit tanpa mandat', format('select kso.terbitkan_penawaran(%s,12000)',b), 'TIDAK_ADA_MANDAT');
  perform kso.terbitkan_penawaran(a, 21000);
  perform uji.cek('Negosiasi di atas lantai → AM jalan sendiri', kso.cek_negosiasi(a,19000,900) like 'BEBAS%');
  perform uji.cek('Negosiasi di bawah lantai → terkunci', kso.cek_negosiasi(a,18000,900) like 'TERKUNCI%lantai%');
  perform uji.cek('Volume turun di bawah minimum → terkunci walau harga aman', kso.cek_negosiasi(a,20000,600) like 'TERKUNCI%volume%');
  perform uji.harus_gagal('Transisi tidak sah ditolak', format('select kso.ubah_status(%s,''DIAJUKAN'',''x'')',a), 'TRANSISI_TIDAK_SAH');

  -- === forum ===
  perform uji.harus_gagal('Forum hanya Selasa/Kamis', 'select kso.susun_agenda(''2026-10-21'')', 'FORUM_HANYA_SELASA_KAMIS');
  fr1 := kso.susun_agenda('2026-10-20', clock_timestamp());  -- batas eksplisit: uji tak boleh kedaluwarsa karena kalender
  perform uji.cek('Agenda A maks 3, urut capex terbesar (C pertama)',
     (select count(*)=3 from kso.agenda_item where forum_id=fr1 and jenis='A')
     and (select rencana_id from kso.agenda_item where forum_id=fr1 and urut=1)=c);
  perform uji.cek('Agenda B memuat putusan jalur cepat', exists(select 1 from kso.agenda_item where forum_id=fr1 and jenis='B' and rencana_id=a));
  fx := kso.susun_agenda('2026-11-05', now() - interval '1 day');
  perform uji.cek('Usulan yang masuk sesudah batas 14.00 menunggu forum berikutnya',
     (select count(*)=0 from kso.agenda_item where forum_id=fx and jenis='A')
     and exists (select 1 from kso.rencana_kso where status='JALUR_FORUM'));
  delete from kso.forum where id = fx;
  -- putusan jalur cepat SESUDAH agenda forum 20 Okt terbit harus muncul di Agenda B forum berikutnya
  q := kso.buat_draft('AM-04','F05','Z3',1,600,'data LIS 6 bulan',18500,'baru',36,'{}',dk);
  perform kso.ajukan(q); perform kso.putus_hod(q,'HB-IVD','setuju'); perform kso.putus_hod(q,'HA-TIM','setuju');
  perform kso.simpan_pendapat_hod(b,'HB-IVD','Volume wajar, data LIS terlampir');
  perform uji.harus_gagal('DITAHAN tanpa tiga kolom tidak bisa disimpan',
     format('select kso.usulkan(%s,%s,''DITAHAN'')', (select rencana_id from kso.agenda_item where forum_id=fr1 and urut=3), fr1), 'check');
  perform uji.harus_gagal('Bersyarat tanpa daftar syarat ditolak', format('select kso.usulkan(%s,%s,''DIREKOMENDASIKAN_BERSYARAT'')',b,fr1), 'check|BELUM_DIAGENDAKAN');
  perform uji.cek('Contoh B ada di agenda forum pertama', (select status from kso.rencana_kso where id=b)='DIAGENDAKAN');
  perform kso.usulkan(b,fr1,'DIREKOMENDASIKAN_BERSYARAT','[{"isi":"eskalasi harga tahunan","tipe":"masuk_pks"},{"isi":"kewajiban lapor test","tipe":"masuk_pks"}]',
                      null,null,null,null,'{"lantai":12000,"target":13500,"capex_maks":80000000,"volume_min":1900,"tenor_maks":36}');
  perform uji.harus_gagal('Direksi setuju tanpa mandat ditolak', format('select kso.putus_direksi(%s,''SETUJU'')',b), 'MANDAT_TIDAK_LENGKAP');
  perform uji.harus_gagal('Direksi setuju tanpa volume minimum ditolak (SK Pasal 11)', format('select kso.putus_direksi(%s,''SETUJU'',null,12000,13500,36,80000000,null)',b), 'MANDAT_TIDAK_LENGKAP');
  perform uji.cek('Direksi setuju + mandat lengkap → MANDAT_TERBIT', kso.putus_direksi(b,'SETUJU',null,12000,13500,36,80000000,1900)='MANDAT_TERBIT');
  perform kso.usulkan(c,fr1,'TIDAK_DIREKOMENDASIKAN',null,null,null,null,'Piutang 94 hari; eksklusivitas + alat jatuh ke RS; volume bersumber lisan');
  perform uji.cek('Komite usul ditolak → tetap Direksi yang memutus', exists(select 1 from kso.v_antrean where antrean='Direksi · Putusan' and rencana_id=c));
  perform uji.cek('Batas putusan Direksi = 22.00 WIB walau server berjalan di UTC',
     (select to_char(batas at time zone 'Asia/Jakarta','HH24:MI')='22:00' from kso.v_antrean where antrean='Direksi · Putusan' and rencana_id=c));
  perform uji.cek('Direksi tolak → DITOLAK_DIREKSI', kso.putus_direksi(c,'TOLAK','Setuju dengan komite')='DITOLAK_DIREKSI');
  k := (select rencana_id from kso.agenda_item where forum_id=fr1 and jenis='A' and rencana_id not in (b,c) limit 1);
  perform kso.usulkan(k,fr1,'DITAHAN',null,'Data volume 3 bulan dari LIS','AM pengusul','2026-10-27');
  perform uji.cek('Usulan ditahan bisa dilengkapi lalu diajukan ulang', kso.ajukan(k)='FORUM');
  fr2 := kso.susun_agenda('2026-10-22', clock_timestamp());
  perform uji.cek('Usulan yang pernah ditahan dapat urutan pertama di forum berikutnya',
     (select rencana_id from kso.agenda_item where forum_id=fr2 and urut=1)=k);
  perform uji.cek('Putusan jalur cepat sesudah agenda sebelumnya terbit tidak tercecer (Agenda B)',
     exists (select 1 from kso.agenda_item where forum_id=fr2 and jenis='B' and rencana_id=q)
     and not exists (select 1 from kso.agenda_item where forum_id=fr2 and jenis='B' and rencana_id=a));

  -- === ujung rantai ===
  perform kso.terbitkan_penawaran(b, 13500);
  perform uji.harus_gagal('PKS di bawah lantai mandat ditolak', format('select kso.catat_pks(%s,11000)',b), 'KELUAR_MANDAT');
  perform kso.catat_pks(b, 12500);
  perform uji.harus_gagal('Serah terima tanpa nomor seri ditolak', format('select kso.serah_terima(%s,null)',b), 'NOMOR_SERI_WAJIB');
  perform kso.serah_terima(b, 'Z52-2610-0042', '2026-11-01');
  perform uji.cek('Serah terima → TERPASANG dan jadwal verifikasi bulan ke-6 terbentuk',
     (select status from kso.rencana_kso where id=b)='TERPASANG'
     and exists (select 1 from kso.verifikasi_bulan6 where rencana_id=b and volume_dijanjikan=2400));
  update kso.verifikasi_bulan6 set volume_aktual = 2100 where rencana_id = b;
  perform uji.cek('KPI memakai harga di PKS: Rp 12.500 ÷ lantai Rp 12.000',
     (select realisasi_harga_rata=1.042 and akurasi_volume_median=0.875 from kso.v_kpi_am where am_id='AM-02'));
  -- mandat kedaluwarsa: hilang dari antrean admin sales, muncul di antrean komite, tidak bisa diterbitkan
  update kso.mandat set berlaku_sampai = kso.hari_ini() - 1 where rencana_id = q;
  perform uji.cek('Mandat kedaluwarsa hilang dari antrean admin sales dan muncul di antrean komite',
     not exists (select 1 from kso.v_antrean where antrean='Admin Sales · Terbitkan Penawaran' and rencana_id=q)
     and exists (select 1 from kso.v_antrean where antrean='Komite · Mandat Kedaluwarsa' and rencana_id=q));
  perform uji.harus_gagal('Penawaran dengan mandat kedaluwarsa ditolak', format('select kso.terbitkan_penawaran(%s,20000)',q), 'MANDAT_KEDALUWARSA');
  perform uji.harus_gagal('Minta kelonggaran sebelum penawaran terbit ditolak', format('select kso.minta_kelonggaran(%s,''x'')',q), 'BUKAN_TAHAP_NEGOSIASI');
  perform kso.tarik_ke_forum(q, 'Komite menarik putusan jalur cepat');
  perform uji.cek('Komite bisa menarik putusan jalur cepat ke forum (SK Pasal 7 ayat 4)', (select status from kso.rencana_kso where id=q)='JALUR_FORUM');

  delete from kso.agenda_item where forum_id=fr2;
  update kso.rencana_kso set status='JALUR_FORUM' where status='DIAGENDAKAN';
  update kso.rencana_kso set status='KALAH' where status='JALUR_FORUM';
  fr3 := kso.susun_agenda('2026-10-27', clock_timestamp());
  perform uji.cek('Tanpa usulan → forum jadi tinjauan portofolio, tidak batal', (select mode from kso.forum where id=fr3)='portofolio');

  -- === minta kelonggaran saat negosiasi ===
  perform kso.minta_kelonggaran(a,'RS menekan ke Rp 17.000');
  perform uji.cek('Minta kelonggaran → kembali ke antrean forum', (select status from kso.rencana_kso where id=a)='JALUR_FORUM');

  -- === view ===
  perform uji.cek('v_antrean, v_agenda, v_kpi_am, v_ringkasan bisa dibaca',
     (select count(*) from kso.v_antrean)>0 and (select count(*) from kso.v_agenda)>0
     and (select count(*) from kso.v_kpi_am)>0 and (select total_diajukan from kso.v_ringkasan)>0);
  perform uji.cek('KPI menandai pemecahan paket AM-01', (select sum(flag_pemecahan_paket) from kso.v_kpi_am where am_id='AM-01')>=1);
end $$;
