-- Uji otomatis. Jalankan setelah migrasi 224–266 + 004 + 005. Setiap baris "LULUS" = satu perilaku terbukti.
-- Sejak 265/266 (Pedoman Komite KSO Forum v01): GPM deal + 4 zona + 7 gerbang v2 + mandat tiga harga.
-- Angka GPM dari tiruan F172 di 005_tiruan_bottomline.sql (fiktif).
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
-- VOLATILE (bawaan): dibaca dengan snapshot baru, jadi melihat perubahan dari kso.ajukan() di ekspresi yang sama
create or replace function uji.zona(p_id bigint) returns text language sql as $$ select zona from kso.rencana_kso where id=p_id $$;
create or replace function uji.status(p_id bigint) returns text language sql as $$ select status::text from kso.rencana_kso where id=p_id $$;
create table if not exists uji.id (k text primary key, v bigint);

do $$
declare a bigint; h bigint; h2 bigint; b bigint; c bigint; k bigint; q bigint; t bigint; hd bigint; fr1 bigint; fr2 bigint; fr3 bigint; fx bigint;
  dk jsonb := '[{"nama":"dr. Rina SpPK","tipe":"kepala_instalasi","sip":["F01"],"tanggal":"2026-10-10","cara":"kunjungan"}]';
begin
  -- === empat zona (angka tiruan 005) ===
  a := kso.buat_draft('AM-01','F01','Z3',1,900,'data LIS 3 bulan terakhir, dikirim kepala lab',18500,'baru',36,'{}',dk);
  perform uji.cek('Zona AM: GPM Z3 @ Rp 18.500 / 900 tes ≈ 74,8%, tujuh gerbang hijau',
                  uji.pola(a)='hhhhhhh' and (select zona_dasar='am' and round(gpm_deal,3)=0.748 from kso.rencana_kso where id=a));
  perform uji.cek('Zona AM: diputus AM sendiri (jalur AM, DIPUTUS_AM)', kso.ajukan(a)='AM' and uji.status(a)='DIPUTUS_AM');
  perform uji.cek('Mandat tiga harga @ 900 tes: pembuka 10.400 (55%) · target 9.400 (50%) · batas bawah 8.500 (45%)',
                  (select harga_pembuka=10400 and harga_target=9400 and harga_lantai=8500 and volume_terbukti=900
                          and volume_minimum=720 and sumber='otomatis' from kso.mandat where rencana_id=a));
  h := kso.buat_draft('AM-01','F01','Z3',1,900,'data LIS 3 bulan',10000,'baru',36,'{}',dk);
  perform uji.cek('Zona 2 HOD: Rp 10.000 → GPM ≈ 53,3% → jalur cepat', kso.ajukan(h)='CEPAT' and uji.zona(h)='hod');
  b := kso.buat_draft('AM-02','F02','Z52',1,2400,'data LIS 3 bulan, ekspor dari sistem RS',12000,'baru',36,'{}',dk);
  perform uji.cek('Zona Forum: GPM ≈ 45,1%; bukti tertulis menunggu verifikasi Sekretaris; 1 Z52 idle → relokasi merah',
                  uji.pola(b)='hbmhhhh' and (select zona_dasar from kso.rencana_kso where id=b)='forum');
  perform uji.cek('Zona Forum + gerbang tidak hijau → naik ke level Direktur, tetap jalur forum (keputusan 31 Okt)',
                  kso.ajukan(b)='FORUM' and uji.zona(b)='direktur');
  c := kso.buat_draft('AM-03','F03','EXZ8000',1,1800,'catatan lisan pengadaan',95000,'baru',36,'{eksklusivitas,alat_jatuh}',dk);
  perform uji.cek('Zona Direktur: GPM ≈ 31,9%, volume lisan, piutang 94 hari, klausul khusus', uji.pola(c)='mmhhmhm');
  perform uji.harus_gagal('Zona Direktur tanpa alasan strategis tidak bisa dikirim', format('select kso.ajukan(%s)',c), 'ALASAN_STRATEGIS_WAJIB');
  update kso.rencana_kso set alasan_strategis = 'Masuk jaringan RS grup — referensi wilayah Barat' where id = c;
  perform uji.cek('Zona Direktur + alasan strategis → jalur forum (forum dulu, Direktur memutus)', kso.ajukan(c)='FORUM' and uji.zona(c)='direktur');

  -- === aturan intake: tidak ada kolom yang terisi diam-diam ===
  k := kso.buat_draft('AM-01','F01','Z3',1,900,'   ',18500,'baru',36,'{}',dk);
  perform uji.harus_gagal('Sumber volume kosong ditahan AI', format('select kso.ajukan(%s)',k), 'SUMBER_VOLUME_KOSONG');
  k := kso.buat_draft('AM-01','F01','Z3',1,900,'lisan',18500,'baru',36,'{}','[]');
  perform uji.harus_gagal('Tanpa pendukung tidak bisa dikirim', format('select kso.ajukan(%s)',k), 'KOLOM_WAJIB_KOSONG: pendukung');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',18500,'baru',null,'{}',dk);
  perform uji.cek('Tenor tidak diucapkan AM → tetap kosong, bukan 36', (select tenor_bulan is null from kso.rencana_kso where id=k));
  perform uji.harus_gagal('Tanpa tenor tidak bisa dikirim', format('select kso.ajukan(%s)',k), 'KOLOM_WAJIB_KOSONG: tenor_bulan');

  -- === eskalasi: satu gerbang tidak hijau = naik satu level ===
  k := kso.buat_draft('AM-01','F04','Z3',1,900,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Piutang 5× tagihan → gerbang 5 merah', uji.pola(k)='hhhhmhh');
  perform uji.cek('Zona AM + satu gerbang merah → naik ke 2 HOD', kso.ajukan(k)='CEPAT' and uji.zona(k)='hod');
  k := kso.buat_draft('AM-01','F01','Z3',1,900,'perkiraan lisan kepala lab',18500,'baru',36,'{}',dk);
  perform uji.cek('Volume lisan tidak diterima sebagai bukti → gerbang 2 merah', substr(uji.pola(k),2,1)='m');
  perform uji.cek('Zona AM + volume lisan → naik ke 2 HOD', kso.ajukan(k)='CEPAT');
  k := kso.buat_draft('AM-02','F02','Z52',1,2400,'surat RS bertanda tangan direktur',12000,'idle',36,'{}',dk);
  perform uji.cek('Surat RS = bukti tertulis; unit idle dipakai → relokasi hijau', (select volume_sumber_label='data' from kso.rencana_kso where id=k) and substr(uji.pola(k),3,1)='h');

  -- === gerbang spesifik ===
  k := kso.buat_draft('AM-04','F05','Z52',1,1500,'data LIS',12000,'baru',36,'{}',dk);
  perform uji.cek('Jember tanpa teknisi kimia → gerbang 4 merah', substr(uji.pola(k),4,1)='m');
  k := kso.buat_draft('AM-01','F07','Z3',1,500,'lisan',18500,'baru',36,'{}',dk);
  perform uji.cek('Faskes luar coverage → gerbang 4 merah', substr(uji.pola(k),4,1)='m');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',18500,'eks_kso',48,'{}',dk);
  perform uji.cek('Unit eks-KSO lolos relokasi; tenor 48 → gerbang 6 merah', uji.pola(k)='hhhhhmh');
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',9000,'baru',36,'{}',dk);
  perform uji.cek('Harga turun ke Rp 9.000 → GPM ≈ 48,1% → zona Forum, bukti tunggu verifikasi', uji.pola(k)='hbhhhhh' and (select zona_dasar='forum' from kso.rencana_kso where id=k));
  k := kso.buat_draft('AM-02','F06','Z3',1,900,'data',10000,'baru',36,'{}',dk,null,null,20000000);
  perform uji.cek('Instalasi Rp 20 jt ikut cicilan → GPM turun dari zona HOD ke Forum', (select zona_dasar='forum' from kso.rencana_kso where id=k));
  k := kso.buat_draft('AM-02','F06','Z3',2,900,'data',18500,'baru',36,'{}',dk);
  perform uji.cek('Dua unit untuk volume yang sama → biaya tetap & cicilan ganda, GPM turun',
                  (select gpm_deal < (select gpm_deal from kso.rencana_kso where id=a) from kso.rencana_kso where id=k));
  t := kso.buat_draft('AM-01','F01','TANPA',1,900,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Alat tanpa peta model → GPM & relokasi belum bisa dicek', substr(uji.pola(t),1,1)='b' and substr(uji.pola(t),3,1)='b'
                  and (select nilai like '%belum dipetakan%' from kso.gerbang_hasil where rencana_id=t and no=1));
  perform uji.cek('Data GPM tak lengkap → jalur forum', kso.ajukan(t)='FORUM');
  hd := kso.buat_draft('AM-01','F01','HDX',1,60,'data tindakan SIMRS',400000,'baru',36,'{}',dk);
  perform uji.cek('Hemodialisa tanpa zona: Kalkulator HD, selalu Direktur (tanpa wajib alasan strategis)',
                  (select nilai like '%Kalkulator HD%' from kso.gerbang_hasil where rencana_id=hd and no=1)
                  and kso.ajukan(hd)='FORUM' and uji.zona(hd)='direktur');
  perform kso.hitung_gerbang(a, true);
  perform uji.cek('Mode data OS hari ini → gerbang 2–6 belum bisa dicek', uji.pola(a)='hbbbbbh');
  perform kso.hitung_gerbang(a, false);
  perform uji.cek('Aturan pemecahan paket v1 tidak lagi menandai', not exists (select 1 from kso.rencana_kso where pecah_paket));

  -- === aturan grup mitra (SK Pasal 14) ===
  insert into kso.grup_mitra values ('GRUP-X', 4, true);
  insert into kso.faskes (id,nama,cabang,grup,piutang_hari,piutang_nilai,tagihan_bulanan) values ('F09','RS Grup X — Surabaya','Surabaya','GRUP-X',10,10000000,10000000);
  k := kso.buat_draft('AM-02','F09','Z3',1,900,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Grup dengan KSO rating 4: tujuh gerbang hijau, zona AM', uji.pola(k)='hhhhhhh' and (select zona_dasar='am' from kso.rencana_kso where id=k));
  perform uji.cek('Grup dengan KSO rating 4: tetap masuk forum (SK Pasal 14)', kso.ajukan(k)='FORUM');
  perform uji.cek('Alasan forum di luar gerbang tercatat', (select alasan_forum like '%rating 4%' from kso.rencana_kso where id=k));
  insert into kso.grup_mitra values ('GRUP-Y', null, null);
  insert into kso.faskes (id,nama,cabang,grup,piutang_hari,piutang_nilai,tagihan_bulanan) values ('F10','RS Grup Y — Sidoarjo','Sidoarjo','GRUP-Y',10,10000000,10000000);
  k := kso.buat_draft('AM-02','F10','Z3',1,900,'data LIS',18500,'baru',36,'{}',dk);
  perform uji.cek('Status grup belum diketahui → forum, bukan zona AM', kso.ajukan(k)='FORUM');

  -- === verifikasi bukti volume oleh Sekretaris ===
  perform uji.harus_gagal('Bukti ditolak tanpa alasan ditolak', format('select kso.verifikasi_volume(%s,false,null,''uji'')',b), 'ALASAN_WAJIB');
  perform kso.verifikasi_volume(b, true, null, 'sekretaris:uji');
  perform uji.cek('Sekretaris memverifikasi bukti → gerbang 2 hijau', substr(uji.pola(b),2,1)='h');
  perform uji.harus_gagal('Verifikasi sesudah putusan ditolak', format('select kso.verifikasi_volume(%s,true,null,''uji'')',a), 'BUKAN_TAHAP_VERIFIKASI');

  -- === jalur cepat: dua kursi HOD ===
  perform uji.harus_gagal('HOD Area Barat tidak berwenang untuk faskes Surabaya', format('select kso.putus_hod(%s,''HA-BAR'',''setuju'')',h), 'HOD_TIDAK_BERWENANG');
  perform uji.cek('Satu kursi setuju → masih menunggu kursi kedua', kso.putus_hod(h,'HB-IVD','setuju')='JALUR_CEPAT');
  perform uji.cek('Dua kursi setuju → DIPUTUS_HOD', kso.putus_hod(h,'HA-TIM','setuju')='DIPUTUS_HOD');
  perform uji.cek('Mandat jalur HOD juga tiga harga (batas bawah 8.500 @ 900 tes)',
                  (select harga_lantai=8500 and harga_pembuka=10400 and sumber='otomatis' from kso.mandat where rencana_id=h));
  h2 := kso.buat_draft('AM-01','F08','Z3',1,900,'data LIS',10000,'baru',36,'{}',dk);
  perform uji.cek('Faskes baru tanpa tagihan → jalur cepat', kso.ajukan(h2)='CEPAT');
  perform kso.putus_hod(h2,'HB-IVD','setuju');
  perform uji.cek('Dua kursi bertentangan → naik otomatis ke forum', kso.putus_hod(h2,'HA-TIM','tolak')='JALUR_FORUM');
  perform kso.simpan_pendapat_hod(h2,'HB-IVD','Setuju, volume wajar');
  perform uji.cek('Putusan dan pendapat HOD tersimpan terpisah — jejak pertentangan tidak hilang',
                  (select count(*)=2 from kso.pendapat_hod where rencana_id=h2 and hod_id='HB-IVD'));
  perform uji.harus_gagal('HOD di luar routing tidak bisa berpendapat', format('select kso.simpan_pendapat_hod(%s,''HA-BAR'',''x'')',b), 'HOD_TIDAK_BERWENANG');

  -- === penawaran & negosiasi (mandat zona AM) ===
  perform uji.harus_gagal('Penawaran di bawah batas bawah ditolak', format('select kso.terbitkan_penawaran(%s,8000)',a), 'KELUAR_MANDAT');
  perform uji.harus_gagal('Penawaran tanpa mandat ditolak', format('select kso.terbitkan_penawaran(%s,12000)',b), 'TIDAK_ADA_MANDAT');
  perform kso.terbitkan_penawaran(a, 18500);
  perform uji.cek('Zona AM: penawaran terbit dari mandat otomatis', (select status from kso.rencana_kso where id=a)='PENAWARAN_TERBIT');
  perform uji.cek('Negosiasi di atas batas bawah → AM jalan sendiri', kso.cek_negosiasi(a,9000,900) like 'BEBAS%');
  perform uji.cek('Negosiasi di bawah batas bawah → terkunci', kso.cek_negosiasi(a,8000,900) like 'TERKUNCI%lantai%');
  perform uji.cek('Volume turun > 20% dari bukti → terkunci walau harga aman', kso.cek_negosiasi(a,10000,600) like 'TERKUNCI%volume%');
  perform uji.harus_gagal('Transisi tidak sah ditolak', format('select kso.ubah_status(%s,''DIAJUKAN'',''x'')',a), 'TRANSISI_TIDAK_SAH');

  -- === forum ===
  perform uji.harus_gagal('Forum hanya Selasa/Kamis', 'select kso.susun_agenda(''2026-10-21'')', 'FORUM_HANYA_SELASA_KAMIS');
  fr1 := kso.susun_agenda('2026-10-20', clock_timestamp());  -- batas eksplisit: uji tak boleh kedaluwarsa karena kalender
  perform uji.cek('Agenda A maks 3, urut capex terbesar (C pertama)',
     (select count(*)=3 from kso.agenda_item where forum_id=fr1 and jenis='A')
     and (select rencana_id from kso.agenda_item where forum_id=fr1 and urut=1)=c);
  perform uji.cek('Agenda B memuat putusan zona AM (laporan ke forum) dan jalur cepat',
     exists(select 1 from kso.agenda_item where forum_id=fr1 and jenis='B' and rencana_id=a)
     and exists(select 1 from kso.agenda_item where forum_id=fr1 and jenis='B' and rencana_id=h));
  fx := kso.susun_agenda('2026-11-05', now() - interval '1 day');
  perform uji.cek('Usulan yang masuk sesudah batas 14.00 menunggu forum berikutnya',
     (select count(*)=0 from kso.agenda_item where forum_id=fx and jenis='A')
     and exists (select 1 from kso.rencana_kso where status='JALUR_FORUM'));
  delete from kso.forum where id = fx;
  -- putusan jalur cepat SESUDAH agenda forum 20 Okt terbit harus muncul di Agenda B forum berikutnya
  q := kso.buat_draft('AM-04','F05','Z3',1,900,'data LIS 6 bulan',10000,'baru',36,'{}',dk);
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

  -- === minta kelonggaran saat negosiasi (zona AM) ===
  perform kso.minta_kelonggaran(a,'RS menekan ke Rp 8.000');
  perform uji.cek('Minta kelonggaran di bawah batas bawah → kembali ke antrean forum', (select status from kso.rencana_kso where id=a)='JALUR_FORUM');

  -- === view ===
  perform uji.cek('v_antrean, v_agenda, v_kpi_am, v_ringkasan bisa dibaca',
     (select count(*) from kso.v_antrean)>0 and (select count(*) from kso.v_agenda)>0
     and (select count(*) from kso.v_kpi_am)>0 and (select total_diajukan from kso.v_ringkasan)>0);
  perform uji.cek('Putusan zona AM terhitung siap penawaran / capex disetujui (DIPUTUS_AM ditambal ke view lama)',
     position('DIPUTUS_AM' in pg_get_viewdef('kso.v_ringkasan'::regclass)) > 0
     and position('DIPUTUS_AM' in pg_get_viewdef('kso.v_antrean'::regclass)) > 0);
end $$;
