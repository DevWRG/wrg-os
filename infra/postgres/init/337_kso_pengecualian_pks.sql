-- 337 — F170 Komite KSO: PKS yang menyimpang dari putusan bisa DIRESTUI DIREKTUR (permintaan user 18 Nov 2026).
--
-- Kasus: Direktur memutus, mandat terbit (volume minimum 400), SPH terbit; naskah PKS dari RS ternyata volume
-- minimum 300 → kso.cocokkan_pks (242) menolak dan satu-satunya jalan selama ini #KSO kelonggaran → forum ulang.
-- User: "kalau Direktur sudah approve, penerbitan oleh admin mengikuti yang di-approve Direktur, tanpa kendala".
--   - PKS yang COCOK dengan putusan tetap dicatat Sekretariat seperti biasa (pagar 242 tidak diubah).
--   - PKS yang TIDAK cocok (harga di bawah lantai, tenor, volume minimum, perlindungan wajib, klausul dilarang /
--     di luar usulan, mandat kedaluwarsa) diajukan Sekretariat ke Direktur lewat kso.app_minta_pengecualian_pks:
--     angka PKS + selisihnya + alasan disimpan. Hanya PKS yang memang ditolak pagar yang bisa diajukan.
--   - Direksi menyetujui / menolak lewat kso.app_putus_pengecualian_pks. DISETUJUI = PKS langsung tercatat dengan
--     angka yang sama persis (status PKS_TTD), tanpa mengulang pagar — restu Direktur adalah keputusannya.
--     DITOLAK = wajib alasan; Sekretariat menegosiasikan ulang atau AM membawa ke forum (#KSO kelonggaran).
-- Satu permintaan MENUNGGU per rencana; permintaan baru membatalkan yang lama.

set search_path = kso, public;

create table if not exists kso.pengecualian_pks (
  id              bigserial primary key,
  rencana_id      bigint not null references kso.rencana_kso(id) on delete cascade,
  harga_deal      numeric not null check (harga_deal > 0),
  tenor_bulan     int not null check (tenor_bulan > 0),
  volume_minimum  int not null check (volume_minimum >= 0),
  klausul         text[] not null default '{}',
  selisih         text not null,
  alasan          text not null,
  status          text not null default 'MENUNGGU' check (status in ('MENUNGGU', 'DISETUJUI', 'DITOLAK', 'DIBATALKAN')),
  diminta_oleh    text not null,
  diminta_at      timestamptz not null default now(),
  diputus_oleh    text,
  diputus_at      timestamptz,
  catatan_direksi text
);
create unique index if not exists pengecualian_pks_satu_menunggu on kso.pengecualian_pks (rencana_id) where status = 'MENUNGGU';
create index if not exists pengecualian_pks_rencana on kso.pengecualian_pks (rencana_id, diminta_at desc);
comment on table kso.pengecualian_pks is '337: PKS menyimpang dari putusan yang dimintakan restu Direktur (Sekretariat → Direksi).';

alter table kso.pengecualian_pks enable row level security;
drop policy if exists baca on kso.pengecualian_pks;
create policy baca on kso.pengecualian_pks for select to wrg_app using (kso.boleh_lihat(rencana_id));
grant select on kso.pengecualian_pks to wrg_app;

-- Sekretariat: ajukan PKS yang ditolak pagar ke Direktur. Pagar dijalankan di sub-transaksi yang selalu dibatalkan,
-- jadi tidak ada yang tercatat; pesannya disimpan sebagai selisih.
create or replace function kso.minta_pengecualian_pks(p_id bigint, p_harga_deal numeric, p_tenor int, p_volume_min int,
                                                     p_klausul text[], p_alasan text, p_oleh text)
returns bigint language plpgsql as $$
declare v_status kso.status_rencana; v_err text; v_id bigint;
begin
  select status into v_status from kso.rencana_kso where id = p_id for update;
  if not found then raise exception 'RENCANA_TIDAK_ADA: %', p_id; end if;
  if v_status <> 'PENAWARAN_TERBIT' then raise exception 'BUKAN_TAHAP_PKS: status %', v_status; end if;
  if nullif(btrim(coalesce(p_alasan, '')), '') is null then raise exception 'ALASAN_WAJIB'; end if;
  if length(p_alasan) > 5000 then raise exception 'ALASAN_TERLALU_PANJANG'; end if;
  begin
    perform kso.cocokkan_pks(p_id, p_harga_deal, p_tenor, p_volume_min, p_klausul, p_oleh);
    raise exception 'PKS_SUDAH_COCOK';
  exception when others then v_err := sqlerrm;
  end;
  if v_err = 'PKS_SUDAH_COCOK' then
    raise exception 'PKS_SUDAH_COCOK' using hint = 'PKS cocok dengan putusan — catat langsung dengan Cocokkan & simpan.'; end if;
  if v_err !~ '^(PKS_TIDAK_COCOK|KELUAR_MANDAT|MANDAT_KEDALUWARSA)' then raise exception '%', v_err; end if;
  update kso.pengecualian_pks set status = 'DIBATALKAN' where rencana_id = p_id and status = 'MENUNGGU';
  insert into kso.pengecualian_pks (rencana_id, harga_deal, tenor_bulan, volume_minimum, klausul, selisih, alasan, diminta_oleh)
  values (p_id, p_harga_deal, p_tenor, p_volume_min, coalesce(p_klausul, '{}'), v_err, btrim(p_alasan), p_oleh)
  returning id into v_id;
  return v_id;
end $$;

-- Direksi: setujui → PKS tercatat persis seperti yang diajukan; tolak → wajib alasan.
create or replace function kso.putus_pengecualian_pks(p_pengecualian bigint, p_setuju boolean, p_catatan text, p_oleh text)
returns text language plpgsql as $$
declare e kso.pengecualian_pks; v_status kso.status_rencana;
begin
  select * into e from kso.pengecualian_pks where id = p_pengecualian for update;
  if not found then raise exception 'PENGECUALIAN_TIDAK_ADA: %', p_pengecualian; end if;
  if e.status <> 'MENUNGGU' then raise exception 'PENGECUALIAN_SUDAH_DIPUTUS: %', e.status; end if;
  if not p_setuju and nullif(btrim(coalesce(p_catatan, '')), '') is null then raise exception 'ALASAN_WAJIB'; end if;
  if length(coalesce(p_catatan, '')) > 5000 then raise exception 'ALASAN_TERLALU_PANJANG'; end if;
  update kso.pengecualian_pks
     set status = case when p_setuju then 'DISETUJUI' else 'DITOLAK' end,
         diputus_oleh = p_oleh, diputus_at = now(), catatan_direksi = nullif(btrim(coalesce(p_catatan, '')), '')
   where id = e.id;
  if not p_setuju then return 'DITOLAK'; end if;
  select status into v_status from kso.rencana_kso where id = e.rencana_id for update;
  if v_status <> 'PENAWARAN_TERBIT' then raise exception 'BUKAN_TAHAP_PKS: status %', v_status; end if;
  update kso.rencana_kso
     set harga_deal = e.harga_deal, pks_tenor_bulan = e.tenor_bulan, pks_volume_minimum = e.volume_minimum, pks_klausul = e.klausul
   where id = e.rencana_id;
  perform kso.ubah_status(e.rencana_id, 'PKS_TTD', p_oleh || ' (restu Direktur atas PKS menyimpang)');
  return 'DISETUJUI';
end $$;

create or replace function kso.app_minta_pengecualian_pks(p_id bigint, p_harga_deal numeric, p_tenor int, p_volume_min int,
                                                         p_klausul text[], p_alasan text)
returns bigint language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('sekretaris');
  return kso.minta_pengecualian_pks(p_id, p_harga_deal, p_tenor, p_volume_min, p_klausul, p_alasan,
                                    'sekretaris:' || coalesce(kso.uid_saya(), ''));
end $$;

create or replace function kso.app_putus_pengecualian_pks(p_pengecualian bigint, p_setuju boolean, p_catatan text default null)
returns text language plpgsql security definer set search_path = kso, public as $$
begin
  perform kso.wajib_peran('direksi');
  return kso.putus_pengecualian_pks(p_pengecualian, p_setuju, p_catatan, 'direksi:' || coalesce(kso.uid_saya(), ''));
end $$;

revoke execute on function kso.minta_pengecualian_pks(bigint, numeric, int, int, text[], text, text) from public;
revoke execute on function kso.putus_pengecualian_pks(bigint, boolean, text, text) from public;
revoke execute on function kso.app_minta_pengecualian_pks(bigint, numeric, int, int, text[], text) from public;
revoke execute on function kso.app_putus_pengecualian_pks(bigint, boolean, text) from public;
grant execute on function kso.app_minta_pengecualian_pks(bigint, numeric, int, int, text[], text),
                          kso.app_putus_pengecualian_pks(bigint, boolean, text) to wrg_app;
