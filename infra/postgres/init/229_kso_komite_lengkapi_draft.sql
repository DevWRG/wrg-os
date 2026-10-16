-- 229 — F170 Komite KSO Tahap 3: melengkapi draft lewat WhatsApp (#KSO D<id> …)
--
-- Paket rujukan hanya punya buat_draft: tak ada jalan bagi AM menjawab pertanyaan bot
-- ("tenor berapa bulan?") sebelum "kirim". Fungsi ini menambal draft dengan kolom yang
-- BENAR-BENAR dikirim saja — kunci yang tak ada / bernilai null tidak menyentuh kolomnya,
-- jadi jawaban susulan tak pernah menghapus isian sebelumnya dan tak ada nilai bawaan.
-- Hanya untuk status DRAFT/DITAHAN (dua status yang boleh diajukan ulang); sesudah itu
-- isian terkunci. Gerbang dihitung ulang supaya balasan bot memuat hasil terbaru.
--
-- Kolom yang DINYATAKAN AM dicatat di rencana_kso.kolom_dinyatakan. Dua kolom wajib di
-- spesifikasi (bab 3.1) yang di rujukan diam-diam punya nilai bawaan — jumlah (coalesce 1 di
-- buat_draft) dan klausul ('{}' = "tidak ada", gerbang 7 hijau) — baru boleh dikirim lewat bot
-- setelah benar-benar dinyatakan. Fungsi inti ajukan() tidak diubah; pagarnya di pembungkus bot.
--
-- Kunci p_isian: alat_kode, jumlah, volume_estimasi, volume_sumber, harga_per_test,
-- tenor_bulan, unit_status, biaya_instalasi, kompetitor_alat, kompetitor_kontrak_habis,
-- risiko_catatan, lead_asal, klausul (array → MENGGANTI daftar), pendukung (array → DITAMBAHKAN).

set search_path = kso, public;

alter table kso.rencana_kso add column if not exists kolom_dinyatakan text[] not null default '{}';

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
    tenor_bulan              = coalesce((p_isian->>'tenor_bulan')::int, tenor_bulan),
    unit_status              = coalesce((p_isian->>'unit_status')::kso.unit_status, unit_status),
    biaya_instalasi          = coalesce((p_isian->>'biaya_instalasi')::numeric, biaya_instalasi),
    kompetitor_alat          = coalesce(nullif(btrim(p_isian->>'kompetitor_alat'), ''), kompetitor_alat),
    kompetitor_kontrak_habis = coalesce((p_isian->>'kompetitor_kontrak_habis')::date, kompetitor_kontrak_habis),
    risiko_catatan           = coalesce(nullif(btrim(p_isian->>'risiko_catatan'), ''), risiko_catatan),
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

create or replace function kso.app_bot_lengkapi_draft(p_id bigint, p_am text, p_isian jsonb) returns void
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am); perform kso.lengkapi_draft(p_id, p_isian, 'ai_wa'); end $$;

-- pengganti pembungkus 227: jumlah & klausul wajib DINYATAKAN sebelum diajukan lewat bot
create or replace function kso.app_bot_ajukan(p_id bigint, p_am text) returns kso.jalur
language plpgsql security definer set search_path = kso, public as $$
declare v_dinyatakan text[]; v_kurang text[] := '{}';
begin
  perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am);
  select kolom_dinyatakan into v_dinyatakan from kso.rencana_kso where id = p_id;
  if not ('jumlah' = any(v_dinyatakan))  then v_kurang := array_append(v_kurang, 'jumlah'::text); end if;
  if not ('klausul' = any(v_dinyatakan)) then v_kurang := array_append(v_kurang, 'klausul'::text); end if;
  if array_length(v_kurang, 1) > 0 then raise exception 'KOLOM_WAJIB_KOSONG: %', array_to_string(v_kurang, ', '); end if;
  return kso.ajukan(p_id, 'ai_wa');
end $$;

revoke execute on function kso.lengkapi_draft(bigint, jsonb, text) from public;
revoke execute on function kso.app_bot_lengkapi_draft(bigint, text, jsonb) from public;
grant execute on function kso.app_bot_lengkapi_draft(bigint, text, jsonb) to wrg_app;

-- akun peran bot WhatsApp: API mengisi set_config('wrg.kso_user','bot-wa',true) sebelum app_bot_*.
-- Bukan master_user — bot tak pernah login ke web.
insert into kso.pengguna (user_id, peran, ref_id) values ('bot-wa', 'bot_wa', null)
on conflict (user_id) do nothing;
