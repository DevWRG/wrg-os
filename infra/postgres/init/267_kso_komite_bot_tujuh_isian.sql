-- 267 — F170 v2 Fase C2: bot WA tujuh isian (Pedoman Komite KSO Forum v01)
--
-- Template AM di Pedoman: 1 faskes · 2 alat (baru / relokasi idle / tambah unit) · 3 harga deal per tes
-- (+ harga & merek pesaing) · 4 volume per bulan · 5 bukti volume · 6 tenor & klausul · 7 alasan strategis.
-- Keputusan user 31 Okt: pendukung di RS TETAP wajib (bot menanyakan); jumlah unit tak disebut = 1
-- (ditampilkan di ringkasan, AM bisa koreksi); bukti volume cukup teks (foto menyusul).
--
--   * rencana_kso.harga_pesaing (isian 3; merek pesaing tetap di kompetitor_alat).
--   * lengkapi_draft menerima alasan_strategis & harga_pesaing (sisanya sama dengan 229).
--   * app_bot_ajukan tak lagi mewajibkan jumlah dinyatakan (default kolom = 1); klausul tetap wajib.
--   * app_bot_angka_gpm: angka GPM per zona untuk balasan bot sebelum "kirim" — peran bot_wa saja;
--     kso.hitung_gpm sendiri tetap tertutup untuk aplikasi.

set search_path = kso, public;

alter table kso.rencana_kso add column if not exists harga_pesaing numeric check (harga_pesaing >= 0);

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

create or replace function kso.app_bot_ajukan(p_id bigint, p_am text) returns kso.jalur
language plpgsql security definer set search_path = kso, public as $$
declare v_dinyatakan text[];
begin
  perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am);
  -- jumlah tak disebut = 1 (kolom default) — keputusan 31 Okt; klausul tetap harus dijawab AM
  select kolom_dinyatakan into v_dinyatakan from kso.rencana_kso where id = p_id;
  if not ('klausul' = any(v_dinyatakan)) then raise exception 'KOLOM_WAJIB_KOSONG: klausul'; end if;
  return kso.ajukan(p_id, 'ai_wa');
end $$;

create or replace function kso.app_bot_angka_gpm(p_id bigint)
returns table (gpm numeric, zona text, hd boolean, catatan text, biaya_per_tes numeric,
               harga_am numeric, harga_hod numeric, harga_forum numeric, volume_min_forum numeric)
language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('bot_wa');
  return query select g.gpm, g.zona, g.hd, g.catatan, g.biaya_per_tes, g.harga_am, g.harga_hod, g.harga_forum, g.volume_min_forum
                 from kso.hitung_gpm(p_id) g;
end $$;

revoke execute on function kso.lengkapi_draft(bigint, jsonb, text) from public;
revoke execute on function kso.app_bot_ajukan(bigint, text), kso.app_bot_angka_gpm(bigint) from public;
grant execute on function kso.app_bot_ajukan(bigint, text), kso.app_bot_angka_gpm(bigint) to wrg_app;
