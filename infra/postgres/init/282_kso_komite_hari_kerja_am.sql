-- 282 — F170/F172 tahap 2 bottom dinamis: AM menyebut HARI KERJA alat di RS lewat #KSO
-- (keputusan user 6 Nov: "Default + bisa diisi AM"). Kolom kso.rencana_kso.hari_kerja sudah ada (281) dan dipakai
-- kso.hitung_gpm; migrasi ini hanya membuat kso.lengkapi_draft menerimanya. Kosong = parameter Bottom Line (default 25).
-- Isi fungsi = 267 + satu baris hari_kerja.

set search_path = kso, public;

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
