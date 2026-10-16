-- 232 — F170 Komite KSO Tahap 6: label sumber volume + KPI tanpa nol palsu
--
-- Kolom KPI "sumber berbasis data" (v_kpi_am.sumber_data_persen) dihitung dari
-- rencana_kso.volume_sumber_label, label TURUNAN dari kalimat AM (spesifikasi 9.2). Tak ada yang
-- pernah mengisinya → setiap AM tampil 0% = nol palsu. Perbaikan:
--   1. kso.tebak_label_sumber(): aturan kata kunci yang bisa diperiksa (bukan LLM). Ragu → NULL.
--      'lisan' menang atas 'data' bila keduanya muncul ("data dari obrolan") — tak mengklaim
--      berbasis data kalau kalimatnya sendiri menyebut lisan. Kalimat asli AM TIDAK disentuh.
--   2. Trigger: label diisi ulang setiap volume_sumber berubah, KECUALI label sudah dikoreksi
--      manusia (volume_sumber_label_manual = true; koreksi HOD menyusul di layar).
--   3. v_kpi_am: persen dihitung atas usulan BERLABEL saja → NULL ("belum ada data") bila belum
--      ada label, bukan 0%.
-- Keputusan 16 Okt (Tahap 6): aspek KSO NPK 2026 TETAP KOSONG sampai SK AM 2027; v_kpi_am disiapkan
-- sebagai feed SK 2027 (capex terverifikasi + akurasi volume), bukan jumlah kontrak.

set search_path = kso, public;

alter table kso.rencana_kso add column if not exists volume_sumber_label_manual boolean not null default false;

create or replace function kso.tebak_label_sumber(p text) returns kso.label_sumber
language sql immutable as $$
  select case
    when p is null or btrim(p) = '' then null
    when p ~* '(belum|blm|tidak|tdk|ga|gak|nggak) *(ada)? *(data|sumber|angka)|^\s*belum ada\s*$' then 'belum_ada'::kso.label_sumber
    when p ~* '\m(lisan|kata|katanya|cerita|obrolan|ngobrol|perkiraan|kira|kiranya|estimasi|feeling|asumsi|tebakan)\M' then 'lisan'::kso.label_sumber
    when p ~* '\m(lis|simrs|sim|bpjs|laporan|rekap|rekapan|ekspor|export|log|sistem|data|tagihan|faktur|register|logbook)\M' then 'data'::kso.label_sumber
    else null
  end $$;

create or replace function kso.isi_label_sumber() returns trigger language plpgsql as $$
begin
  if not new.volume_sumber_label_manual
     and (tg_op = 'INSERT' or new.volume_sumber is distinct from old.volume_sumber) then
    new.volume_sumber_label := kso.tebak_label_sumber(new.volume_sumber);
  end if;
  return new;
end $$;
drop trigger if exists isi_label_sumber on kso.rencana_kso;
create trigger isi_label_sumber before insert or update of volume_sumber on kso.rencana_kso
  for each row execute function kso.isi_label_sumber();

-- isi baris lama
update kso.rencana_kso set volume_sumber_label = kso.tebak_label_sumber(volume_sumber)
 where not volume_sumber_label_manual and volume_sumber_label is null;

-- v_kpi_am: sama dengan 226, kecuali sumber_data_persen hanya atas usulan berlabel
create or replace view kso.v_kpi_am as
select v.am_id, v.am_nama, to_char(v.diajukan_at at time zone 'Asia/Jakarta','YYYY-"Q"Q') as periode,
       count(*)                                                     as usulan_diajukan,
       count(*) filter (where v.jalur = 'CEPAT')                    as usulan_jalur_cepat,
       count(*) filter (where v.jalur = 'FORUM')                    as usulan_forum,
       count(*) filter (where exists (select 1 from kso.riwayat_status s where s.rencana_id = v.id and s.ke = 'DITAHAN')) as usulan_pernah_ditahan,
       round(100.0 * count(*) filter (where not exists (select 1 from kso.riwayat_status s where s.rencana_id = v.id and s.ke = 'DITAHAN'))
             / nullif(count(*),0), 1)                               as kelengkapan_pertama_persen,
       sum(v.capex) filter (where v.status in ('PKS_TTD','TERPASANG')) as capex_ditempatkan,
       sum(v.capex) filter (where vb.rasio >= 0.8)                  as capex_terverifikasi,
       percentile_cont(0.5) within group (order by vb.rasio)        as akurasi_volume_median,
       round(avg(v.harga_deal / nullif(md.harga_lantai,0)) filter (where v.harga_deal is not null), 3) as realisasi_harga_rata,  -- harga di PKS ÷ lantai
       round(100.0 * count(*) filter (where r.volume_sumber_label = 'data') / nullif(count(*) filter (where r.volume_sumber_label is not null),0), 1) as sumber_data_persen,
       count(*) filter (where v.pecah_paket)                       as flag_pemecahan_paket
  from kso.v_rencana v
  join kso.rencana_kso r on r.id = v.id
  left join kso.verifikasi_bulan6 vb on vb.rencana_id = v.id
  left join kso.mandat md on md.rencana_id = v.id
 where v.diajukan_at is not null
 group by v.am_id, v.am_nama, to_char(v.diajukan_at at time zone 'Asia/Jakarta','YYYY-"Q"Q');
;
alter view kso.v_kpi_am set (security_invoker = on);
revoke execute on function kso.isi_label_sumber() from public;
grant execute on function kso.tebak_label_sumber(text) to wrg_app;
