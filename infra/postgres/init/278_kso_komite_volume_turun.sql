-- 278: F170 Komite KSO — "Volume yang dijanjikan RS turun > 20% dari bukti → mandat dihitung ulang"
-- (Pedoman Komite KSO Forum v01, aturan pakai mandat). Keputusan user 5 Nov 2026: volume baru dilaporkan
-- AM lewat WhatsApp "#KSO D12 volume 900".
--
-- kso.volume_turun(id, volume):
--   * hanya untuk usulan yang sedang memegang mandat (Diputus AM / Diputus HOD / Mandat terbit / Penawaran terbit);
--   * volume baru ≥ (1 − 20%) × volume terbukti mandat → "toleransi": dicatat di jawaban, mandat tetap;
--   * turun > 20% → volume usulan diganti, gerbang + GPM + zona dihitung ulang (kso.tentukan_level, 269), lalu
--       - mandat jalur AM / 2 HOD yang zonanya NAIK → wewenang itu gugur → usulan ditarik ke forum;
--       - selain itu tiga harga mandat dihitung ulang di volume baru — HANYA BOLEH NAIK (greatest): putusan
--         sebelumnya tak pernah dilonggarkan oleh pengurangan volume; volume terbukti & volume minimum ikut turun;
--       - data GPM belum lengkap (biaya/HPP kosong) → tak bisa dihitung ulang → ditarik ke forum.
-- Ambang 20% = kso.parameter 'volume_turun_rasio' (0,8), bisa diubah tanpa migrasi.

insert into kso.parameter (kunci, nilai, catatan)
values ('volume_turun_rasio', 0.8, 'Volume RS di bawah rasio ini × volume terbukti mandat → mandat dihitung ulang (Pedoman: turun > 20%)')
on conflict (kunci) do nothing;

create or replace function kso.volume_turun(p_id bigint, p_volume int, p_oleh text default 'ai_wa')
returns jsonb language plpgsql as $$
declare r kso.rencana_kso; m kso.mandat; g record; v_dasar numeric; v_batas numeric; v_level int; v_alasan text;
        v_lama int; v_baru text;
begin
  select * into r from kso.rencana_kso where id = p_id for update;
  if r.id is null then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if r.status not in ('DIPUTUS_AM','DIPUTUS_HOD','MANDAT_TERBIT','PENAWARAN_TERBIT') then
    raise exception 'BUKAN_TAHAP_MANDAT: status %', r.status; end if;
  select * into m from kso.mandat where rencana_id = p_id;
  if m.rencana_id is null then raise exception 'TIDAK_ADA_MANDAT'; end if;
  if p_volume is null or p_volume <= 0 then raise exception 'VOLUME_TIDAK_SAH'; end if;

  v_dasar := coalesce(m.volume_terbukti, r.volume_estimasi);
  v_batas := ceil(v_dasar * kso.param('volume_turun_rasio'));
  if p_volume >= v_batas then
    return jsonb_build_object('hasil', 'toleransi', 'volume_dasar', v_dasar, 'volume_batas', v_batas, 'volume_baru', p_volume);
  end if;

  v_lama := kso.level_zona(r.zona);
  update kso.rencana_kso set volume_estimasi = p_volume, diubah_at = now() where id = p_id;
  perform kso.hitung_gerbang(p_id);
  select t.level, t.alasan into v_level, v_alasan from kso.tentukan_level(p_id) t;
  v_baru := kso.zona_level(v_level);
  select * into g from kso.hitung_gpm(p_id);

  if (r.jalur in ('AM','CEPAT') and v_level > coalesce(v_lama, 0)) or g.harga_forum is null then
    update kso.rencana_kso set zona = kso.zona_level(greatest(v_level, 2)), jalur = 'FORUM' where id = p_id;
    perform kso.tarik_ke_forum(p_id,
      'Volume RS turun dari ' || v_dasar || ' ke ' || p_volume || ' tes/bln (> 20%) — '
      || case when g.harga_forum is null then 'data GPM belum lengkap, mandat tak bisa dihitung ulang'
              else 'GPM turun ke zona ' || v_baru || ', mandat ' || case when r.jalur = 'AM' then 'zona AM' else 'jalur cepat' end || ' gugur' end, p_oleh);
    return jsonb_build_object('hasil', 'ke_forum', 'volume_dasar', v_dasar, 'volume_baru', p_volume, 'zona', v_baru,
                              'gpm', g.gpm, 'tanpa_angka', g.harga_forum is null);
  end if;

  update kso.rencana_kso set zona = v_baru where id = p_id;
  update kso.mandat set
         harga_pembuka   = greatest(coalesce(harga_pembuka, 0), ceil(g.harga_am / 100) * 100),
         harga_target    = greatest(coalesce(harga_target, 0),  ceil(g.harga_hod / 100) * 100),
         harga_lantai    = greatest(harga_lantai,               ceil(g.harga_forum / 100) * 100),
         volume_terbukti = p_volume,
         volume_minimum  = floor(p_volume * kso.param('volume_minimum_rasio'))
   where rencana_id = p_id
  returning * into m;
  return jsonb_build_object('hasil', 'dihitung_ulang', 'volume_dasar', v_dasar, 'volume_baru', p_volume, 'zona', v_baru, 'gpm', g.gpm,
                            'pembuka', m.harga_pembuka, 'target', m.harga_target, 'lantai', m.harga_lantai,
                            'volume_minimum', m.volume_minimum, 'berlaku_sampai', m.berlaku_sampai);
end $$;

create or replace function kso.app_bot_volume_turun(p_id bigint, p_am text, p_volume int) returns jsonb
language plpgsql security definer set search_path = kso, public as $$
begin perform kso.wajib_peran('bot_wa'); perform kso.wajib_milik(p_id, p_am); return kso.volume_turun(p_id, p_volume, 'ai_wa'); end $$;

-- fungsi baru di schema kso terbuka untuk PUBLIC secara bawaan → tutup; hanya pembungkus bot untuk aplikasi
revoke execute on function kso.volume_turun(bigint, int, text), kso.app_bot_volume_turun(bigint, text, int) from public;
grant execute on function kso.app_bot_volume_turun(bigint, text, int) to wrg_app;
