-- 302 — F170 Komite KSO: format WhatsApp #KSO sembilan isian + FEE + lampiran PDF Simulator CPRR.
--
-- Keputusan product owner (10 Nov 2026):
--   * Usulan baru HANYA lewat format berlabel (FASKES · ALAT · TES · MASA KSO · PERMINTAAN HARGA · FEE · KOMPETITOR ·
--     KLAUSUL · LAMPIRAN), diurai deterministik di API (tanpa LLM). Jalur teks bebas & voice note dimatikan di API.
--   * FEE = fee ke RS/perantara yang dipotong dari harga. GPM dihitung dari harga BERSIH = harga × (1 − fee/100);
--     harga minimum per zona yang dicetak = harga KOTOR yang perlu diminta supaya bersihnya cukup:
--     biaya ÷ (1 − g) ÷ (1 − fee). Mandat (pembuka/target/lantai) ikut harga kotor ini karena memakai kso.hitung_gpm.
--   * KLAUSUL: ADA wajib disertai detail. Detail yang tak cocok ke kode klausul khusus dicatat sebagai 'lainnya'
--     (gerbang 7 merah — klausul non-standar tetap dibahas, bukan diloloskan).
--   * LAMPIRAN = PDF cetakan Simulator KSO ("KSO CPRR — <KATEGORI>") yang dibaca OCR (services/ai /kso/ocr-cprr) lalu
--     dicocokkan dengan isian. Setiap lampiran disimpan di kso.rencana_lampiran; yang lolos mengisi hari kerja dan
--     sumber volume ("Lampiran Simulator CPRR <tanggal>", label 'data' — Sekretariat tetap memverifikasi untuk Forum).
--   * Alat yang tak cocok pasti ke katalog: kso.rencana_kso.alat_kode NOT NULL + FK dan dipakai semua fungsi gerbang,
--     jadi draft TIDAK dibuat dengan alat kosong. Isian disimpan di kso.intake_tertunda sampai AM memilih alat
--     ("#KSO ALAT 1" / "#KSO ALAT: Z50"); isian lain tidak hilang.
-- Isi kso.lengkapi_draft = 282 + fee_persen/klausul_ada/klausul_detail. Isi kso.hitung_gpm = 284 + fee.

set search_path = kso, public;

-- ---------- kolom ----------
alter table kso.rencana_kso
  add column if not exists fee_persen     numeric check (fee_persen >= 0 and fee_persen < 100),
  add column if not exists klausul_ada    boolean,
  add column if not exists klausul_detail text;
comment on column kso.rencana_kso.fee_persen is '302: fee ke RS/perantara (% dari harga per tes). GPM memakai harga × (1 − fee/100). NULL = belum dijawab AM.';
comment on column kso.rencana_kso.klausul_ada is '302: jawaban KLAUSUL: ADA/TIDAK dari format WA. ADA tanpa detail = belum lengkap.';
comment on column kso.rencana_kso.klausul_detail is '302: detail klausul dari RS apa adanya (kalimat AM).';

insert into kso.klausul_khusus values ('lainnya', 'Klausul lain dari RS (lihat detail)', 8) on conflict do nothing;

-- ---------- lengkapi draft: + fee, klausul_ada, klausul_detail ----------
create or replace function kso.lengkapi_draft(p_id bigint, p_isian jsonb, p_oleh text default 'ai_wa')
returns void language plpgsql as $$
declare r kso.rencana_kso; x jsonb;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.status not in ('DRAFT','DITAHAN') then
    raise exception 'DRAFT_TERKUNCI: status %', r.status using hint = 'Isian hanya bisa diubah selama DRAFT atau DITAHAN.';
  end if;

  update kso.rencana_kso set
    alat_kode                = coalesce(p_isian->>'alat_kode', alat_kode),
    jumlah                   = coalesce((p_isian->>'jumlah')::int, jumlah),
    volume_estimasi          = coalesce((p_isian->>'volume_estimasi')::int, volume_estimasi),
    volume_sumber            = coalesce(nullif(btrim(p_isian->>'volume_sumber'), ''), volume_sumber),
    harga_per_test           = coalesce((p_isian->>'harga_per_test')::numeric, harga_per_test),
    harga_pesaing            = coalesce((p_isian->>'harga_pesaing')::numeric, harga_pesaing),
    hari_kerja               = coalesce((p_isian->>'hari_kerja')::int, hari_kerja),
    fee_persen               = coalesce((p_isian->>'fee_persen')::numeric, fee_persen),
    klausul_ada              = coalesce((p_isian->>'klausul_ada')::boolean, klausul_ada),
    klausul_detail           = coalesce(nullif(btrim(p_isian->>'klausul_detail'), ''), klausul_detail),
    tenor_bulan              = coalesce((p_isian->>'tenor_bulan')::int, tenor_bulan),
    unit_status              = coalesce((p_isian->>'unit_status')::kso.unit_status, unit_status),
    biaya_instalasi          = coalesce((p_isian->>'biaya_instalasi')::numeric, biaya_instalasi),
    kompetitor_alat          = coalesce(nullif(btrim(p_isian->>'kompetitor_alat'), ''), kompetitor_alat),
    kompetitor_kontrak_habis = coalesce((p_isian->>'kompetitor_kontrak_habis')::date, kompetitor_kontrak_habis),
    risiko_catatan           = coalesce(nullif(btrim(p_isian->>'risiko_catatan'), ''), risiko_catatan),
    alasan_strategis         = coalesce(nullif(btrim(p_isian->>'alasan_strategis'), ''), alasan_strategis),
    lead_asal                = coalesce((p_isian->>'lead_asal')::kso.lead_asal, lead_asal),
    kolom_dinyatakan         = (select array(select distinct k from unnest(r.kolom_dinyatakan || array(
                                  select key from jsonb_each(p_isian)
                                   where jsonb_typeof(value) <> 'null')) k order by k)),
    diubah_at                = now()
  where id = p_id;

  if jsonb_typeof(p_isian->'klausul') = 'array' then
    delete from kso.rencana_klausul where rencana_id = p_id;
    insert into kso.rencana_klausul select p_id, k from jsonb_array_elements_text(p_isian->'klausul') k;
  end if;
  if jsonb_typeof(p_isian->'pendukung') = 'array' then
    for x in select * from jsonb_array_elements(p_isian->'pendukung') loop
      insert into kso.rencana_pendukung (rencana_id, nama, tipe, sip_faskes, kontak_terakhir_tanggal, kontak_terakhir_cara)
      values (p_id, x->>'nama', (x->>'tipe')::kso.pendukung_tipe,
              case when x ? 'sip' then array(select jsonb_array_elements_text(x->'sip')) end,
              (x->>'tanggal')::date, (x->>'cara')::kso.kontak_cara);
    end loop;
  end if;

  perform kso.hitung_gerbang(p_id);
end $$;
revoke execute on function kso.lengkapi_draft(bigint, jsonb, text) from public;

-- ---------- GPM deal: harga bersih sesudah fee (isi 284 + fee) ----------
create or replace function kso.hitung_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, model_key text,
               biaya_per_tes numeric, harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql stable as $$
declare r kso.rencana_kso; p record; m record; v_n int; v_hpp numeric; v_tetap numeric; v_biaya numeric;
        v_hk int; v_tenor int; v_tangga jsonb; v_reagen numeric; v_f numeric; v_s numeric;
        v_bersih numeric; v_fee numeric;
begin
  select * into r from kso.rencana_kso where id = p_id;
  select * into p from kso.param_gpm();
  select a.model_key as mk, b.hpp, b.biaya_per_tes as reagen, b.biaya_tetap_bulan as tetap, b.biaya_tetap_harian as harian,
         b.qc_bulan as qc, b.satuan, b.biaya_tangga as tangga
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
  elsif m.reagen is null then catatan := 'Biaya reagen per tes belum ada (Bottom Line Alat → Hitung ulang dari Price Book)';
  elsif r.harga_per_test is null or r.harga_per_test <= 0 then catatan := 'Harga per tes belum diisi';
  elsif r.volume_estimasi is null or r.volume_estimasi <= 0 then catatan := 'Volume per bulan belum diisi';
  end if;
  if catatan is not null then return next; return; end if;

  -- 302: fee ke RS/perantara dipotong dari harga → GPM dari harga bersih; harga minimum dicetak sebagai harga kotor
  v_fee := coalesce(r.fee_persen, 0) / 100;
  v_bersih := r.harga_per_test * (1 - v_fee);

  v_hk := coalesce(r.hari_kerja, kso.hari_kerja_default());
  v_tenor := coalesce(nullif(r.tenor_bulan, 0), p.tenor);
  v_n := coalesce(r.jumlah, 1);
  v_hpp := m.hpp * v_n + coalesce(r.biaya_instalasi, 0);
  v_tetap := (coalesce(m.harian * v_hk, m.tetap, 0) + coalesce(m.qc, 0)) * v_n;
  -- 284: pilihan kemasan (cartridge BG): reagen/tes = termurah dari max(per tes, minimum per bulan ÷ volume per unit)
  v_tangga := case when jsonb_typeof(m.tangga) = 'array' and jsonb_array_length(m.tangga) > 0 then m.tangga
                   else jsonb_build_array(jsonb_build_object('per_tes', m.reagen, 'min_bulan', 0)) end;
  select min(greatest((x->>'per_tes')::numeric, (x->>'min_bulan')::numeric * v_n / r.volume_estimasi))
    into v_reagen from jsonb_array_elements(v_tangga) x;
  v_biaya := v_reagen + v_tetap / r.volume_estimasi + v_hpp / (v_tenor * r.volume_estimasi);
  biaya_per_tes := v_biaya;
  gpm := 1 - v_biaya / v_bersih;
  zona := kso.zona_dari(gpm);
  harga_am := v_biaya / (1 - p.g_am) / (1 - v_fee);
  harga_hod := v_biaya / (1 - p.g_hod) / (1 - v_fee);
  harga_forum := v_biaya / (1 - p.g_forum) / (1 - v_fee);
  -- volume minimum zona Forum: per pilihan kemasan, V ≥ max(F ÷ (S − per tes), (minimum + F) ÷ S); ambil terkecil
  v_f := v_tetap + v_hpp / v_tenor;
  v_s := v_bersih * (1 - p.g_forum);
  select min(greatest(v_f / (v_s - (x->>'per_tes')::numeric), ((x->>'min_bulan')::numeric * v_n + v_f) / v_s))
    into volume_min_forum
    from jsonb_array_elements(v_tangga) x where v_s > (x->>'per_tes')::numeric;
  catatan := 'GPM ' || replace(to_char(gpm * 100, 'FM990.0'), '.', ',') || '% → zona '
             || case zona when 'am' then 'AM' when 'hod' then '2 HOD' when 'forum' then 'Forum' else 'Direktur' end
             || case when v_fee > 0 then ' (harga bersih sesudah fee ' || replace(to_char(r.fee_persen, 'FM990.##'), '.', ',') || '%)' else '' end;
  return next;
end $$;
revoke execute on function kso.hitung_gpm(bigint) from public;

-- ---------- lampiran PDF Simulator CPRR ----------
create table if not exists kso.rencana_lampiran (
  id            bigserial primary key,
  rencana_id    bigint not null references kso.rencana_kso(id) on delete cascade,
  wa_message_id text,                              -- wa_message.message_id pesan PDF
  media_path    text,                              -- berkas di MEDIA_ROOT (capture WA)
  sha256        text,
  hasil_ocr     jsonb not null default '{}',       -- jawaban /kso/ocr-cprr apa adanya (isian, galat, halaman)
  cocok         jsonb not null default '{}',       -- per isian: {status: cocok|beda|kosong, pdf, wa}
  lolos         boolean not null default false,
  dibuat_at     timestamptz not null default now()
);
create index if not exists rencana_lampiran_rencana_idx on kso.rencana_lampiran (rencana_id, dibuat_at desc);
create unique index if not exists rencana_lampiran_pesan_uq on kso.rencana_lampiran (rencana_id, wa_message_id)
  where wa_message_id is not null;
comment on table kso.rencana_lampiran is '302: lampiran PDF Simulator CPRR per usulan + hasil OCR & pencocokan. Tulis hanya lewat kso.app_bot_catat_lampiran.';

-- ---------- isian yang menunggu pilihan alat ----------
create table if not exists kso.intake_tertunda (
  id            bigserial primary key,
  am_id         text not null references kso.am(id),
  rencana_id    bigint references kso.rencana_kso(id) on delete cascade,  -- null = usulan baru (draft belum ada)
  faskes_id     text references kso.faskes(id),
  isian         jsonb not null default '{}',       -- isian lengkapi_draft + pendukung, siap dipakai saat alat dipilih
  alat_teks     text,
  saran         jsonb not null default '[]',       -- [{kode, nama, kategori}] urut nomor yang dibalas AM
  wa_message_id text,
  dibuat_at     timestamptz not null default now(),
  selesai_at    timestamptz
);
create index if not exists intake_tertunda_am_idx on kso.intake_tertunda (am_id, dibuat_at desc) where selesai_at is null;
comment on table kso.intake_tertunda is '302: isian #KSO yang alatnya belum pasti (draft butuh alat_kode). Ditutup saat AM memilih alat.';

-- RLS + hak (pola 227): baca saja untuk wrg_app, tulis lewat fungsi security definer
alter table kso.rencana_lampiran enable row level security;
alter table kso.intake_tertunda enable row level security;
drop policy if exists baca on kso.rencana_lampiran;
create policy baca on kso.rencana_lampiran for select to wrg_app using (kso.boleh_lihat(rencana_id));
drop policy if exists baca on kso.intake_tertunda;
create policy baca on kso.intake_tertunda for select to wrg_app
  using (kso.peran_saya() in ('bot_wa','komite','sekretaris','direksi')
         or (kso.peran_saya() = 'am' and am_id = kso.ref_saya()));
revoke all on kso.rencana_lampiran, kso.intake_tertunda from public;
revoke all on sequence kso.rencana_lampiran_id_seq, kso.intake_tertunda_id_seq from public;
do $$ declare r text; begin
  foreach r in array array['wrg_app','wrg_readonly','wrg_demo_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on kso.rencana_lampiran, kso.intake_tertunda from %I', r);
      execute format('revoke all on sequence kso.rencana_lampiran_id_seq, kso.intake_tertunda_id_seq from %I', r);
    end if;
  end loop;
end $$;
grant select on kso.rencana_lampiran, kso.intake_tertunda to wrg_app;

-- bot: catat satu lampiran. Lolos → hari kerja + sumber volume dari PDF (label 'data'), gerbang dihitung ulang.
create or replace function kso.app_bot_catat_lampiran(
  p_id bigint, p_am text, p_wa text, p_media text, p_sha256 text, p_hasil jsonb, p_cocok jsonb, p_lolos boolean,
  p_hari_kerja int default null, p_sumber text default null)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare v_id bigint; v_status kso.status_rencana;
begin
  perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am);
  select status into v_status from kso.rencana_kso where id = p_id for update;
  insert into kso.rencana_lampiran (rencana_id, wa_message_id, media_path, sha256, hasil_ocr, cocok, lolos)
  values (p_id, p_wa, p_media, p_sha256, coalesce(p_hasil, '{}'), coalesce(p_cocok, '{}'), coalesce(p_lolos, false))
  on conflict (rencana_id, wa_message_id) where wa_message_id is not null
  do update set media_path = excluded.media_path, sha256 = excluded.sha256, hasil_ocr = excluded.hasil_ocr,
                cocok = excluded.cocok, lolos = excluded.lolos, dibuat_at = now()
  returning id into v_id;
  if coalesce(p_lolos, false) and v_status in ('DRAFT','DITAHAN') then
    perform kso.lengkapi_draft(p_id, jsonb_strip_nulls(jsonb_build_object(
      'hari_kerja', case when p_hari_kerja between 1 and 31 then p_hari_kerja end,
      'volume_sumber', nullif(btrim(p_sumber), ''))), 'ai_wa');
    -- bukti = cetakan Simulator yang angkanya cocok dengan isian → 'data' (trigger 232 tak mengenali kalimat ini)
    if nullif(btrim(p_sumber), '') is not null then
      update kso.rencana_kso set volume_sumber_label = 'data' where id = p_id and not volume_sumber_label_manual;
      perform kso.hitung_gerbang(p_id);
    end if;
  end if;
  return v_id;
end $$;

create or replace function kso.app_bot_simpan_tertunda(
  p_am text, p_rencana bigint, p_faskes text, p_isian jsonb, p_alat_teks text, p_saran jsonb, p_wa text)
returns bigint language plpgsql security definer set search_path = kso, public as $$
declare v_id bigint;
begin
  perform kso.wajib_peran('bot_wa');
  if p_rencana is not null then perform kso.wajib_milik(p_rencana, p_am); end if;
  -- satu pertanyaan alat terbuka per AM (per draft): yang lama ditutup
  update kso.intake_tertunda set selesai_at = now()
   where am_id = p_am and selesai_at is null and rencana_id is not distinct from p_rencana;
  insert into kso.intake_tertunda (am_id, rencana_id, faskes_id, isian, alat_teks, saran, wa_message_id)
  values (p_am, p_rencana, p_faskes, coalesce(p_isian, '{}'), p_alat_teks, coalesce(p_saran, '[]'), p_wa)
  returning id into v_id;
  return v_id;
end $$;

create or replace function kso.app_bot_tutup_tertunda(p_id bigint, p_am text) returns void
language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('bot_wa');
  update kso.intake_tertunda set selesai_at = now() where id = p_id and am_id = p_am and selesai_at is null;
end $$;

revoke execute on function kso.app_bot_catat_lampiran(bigint, text, text, text, text, jsonb, jsonb, boolean, int, text),
                           kso.app_bot_simpan_tertunda(text, bigint, text, jsonb, text, jsonb, text),
                           kso.app_bot_tutup_tertunda(bigint, text) from public;
grant execute on function kso.app_bot_catat_lampiran(bigint, text, text, text, text, jsonb, jsonb, boolean, int, text),
                          kso.app_bot_simpan_tertunda(text, bigint, text, jsonb, text, jsonb, text),
                          kso.app_bot_tutup_tertunda(bigint, text) to wrg_app;
