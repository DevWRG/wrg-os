// F170 Komite KSO — SPH KSO (Surat Penawaran Harga Kerja Sama Operasional), issue #2297, migrasi 312.
//
// "Terbitkan penawaran" (Sekretariat / Admin Sales) kini juga menerbitkan SPH KSO bernomor dalam transaksi yang
// sama. Keputusan product owner 12 Nov 2026: ditandatangani Direktur, berlaku 30 hari, harga per test BELUM
// termasuk PPN 11%, berlaku untuk semua penawaran (mandat Direksi, zona AM, zona HOD).
//
//   - Penanda tangan: akun aktif grup Direktur (access_group key 'direktur') atau role 'direktur'. Default = Direktur
//     yang memutus rencana ini (kso.putusan_direksi_catatan.oleh_user) bila ada di daftar, selain itu yang pertama.
//     Nama SELALU dari app_user (pola SPH penjualan: tak bisa diketik bebas di surat resmi).
//   - Nomor: penghitung public.sph_pengaturan yang sama dengan SPH penjualan (lib/sph-cetak.ts ambilNomor) — satu
//     urutan surat penawaran perusahaan.
//   - Isi surat = snapshot kso.sph (lihat 312), dicetak oleh kso-sph-pdf.ts.

import type { TransactionSql } from "postgres";

import { db } from "../db.js";
import { ambilNomor, formatNomorSph, tanggalWib } from "../lib/sph-cetak.js";

type Tx = TransactionSql<Record<string, unknown>>;

export const SPH_KSO_BERLAKU_HARI = 30;

export interface KandidatTtdKso {
  userId: string;
  nama: string;
  jabatan: string | null;
}

/** Baris kso.sph untuk layar & PDF. */
export interface SphKso {
  id: number;
  rencana_id: number;
  nomor: string;
  harga_per_test: number;
  jumlah: number;
  tenor_bulan: number;
  volume_minimum: number | null;
  klausul_wajib: string[];
  faskes_nama: string;
  faskes_kota: string | null;
  alat_nama: string;
  berlaku_hari: number;
  terbit_at: string;
  berlaku_sampai: string;
  ttd_nama: string;
  ttd_jabatan: string | null;
}

export const KOLOM_SPH_KSO = `id::int, rencana_id::int, nomor, harga_per_test::float8 as harga_per_test, jumlah, tenor_bulan,
  volume_minimum, klausul_wajib, faskes_nama, faskes_kota, alat_nama, berlaku_hari, terbit_at::text as terbit_at,
  berlaku_sampai::text as berlaku_sampai, ttd_nama, ttd_jabatan`;

/**
 * Akun Direktur yang boleh menandatangani SPH KSO. Dibaca dengan koneksi API biasa (BUKAN di transaksi peran
 * wrg_app — wrg_app tak dijamin boleh membaca app_user, lihat detailRencana).
 */
export async function kandidatTtdKso(): Promise<KandidatTtdKso[]> {
  const rows = await db()`
    SELECT u.id::text AS id, COALESCE(NULLIF(trim(u.name), ''), u.email) AS nama, NULLIF(trim(u.title), '') AS jabatan
      FROM app_user u
     WHERE u.active AND (
       u.role = 'direktur'
       OR EXISTS (SELECT 1 FROM app_user_group m JOIN access_group g ON g.id = m.group_id
                   WHERE m.user_id = u.id AND g.key = 'direktur'))
     ORDER BY 2`;
  return rows.map((r) => ({ userId: String(r.id), nama: String(r.nama), jabatan: r.jabatan ? String(r.jabatan) : null }));
}

/**
 * Pilih penanda tangan: pilihan eksplisit (harus ada di daftar) → Direktur yang memutus → yang pertama.
 * Jabatan kosong di akun → "Direktur". Null = tak ada akun Direktur sama sekali (SPH tak bisa terbit).
 */
export function pilihTtdKso(
  kandidat: KandidatTtdKso[],
  pilihan: string | null | undefined,
  pemutus: string | null | undefined,
): { ok: true; ttd: KandidatTtdKso & { jabatan: string } } | { ok: false; error: string } {
  if (!kandidat.length) return { ok: false, error: "Belum ada akun Direktur (grup Direktur) untuk menandatangani SPH KSO." };
  const p = String(pilihan ?? "").trim();
  let k: KandidatTtdKso | undefined;
  if (p) {
    k = kandidat.find((x) => x.userId === p);
    if (!k) return { ok: false, error: "Penanda tangan SPH harus dipilih dari daftar akun Direktur." };
  } else {
    k = kandidat.find((x) => x.userId === pemutus) ?? kandidat[0];
  }
  return { ok: true, ttd: { ...k, jabatan: k.jabatan ?? "Direktur" } };
}

/** Default pilihan di layar (sama dengan pilihTtdKso tanpa pilihan eksplisit). */
export function ttdDefaultKso(kandidat: KandidatTtdKso[], pemutus: string | null | undefined): string | null {
  return (kandidat.find((x) => x.userId === pemutus) ?? kandidat[0])?.userId ?? null;
}

/**
 * Ambil nomor SPH berikutnya dari penghitung bersama (public.sph_pengaturan, kunci baris FOR UPDATE).
 * Dipanggil di transaksi yang sama dengan pencatatan SPH, jadi nomor tak terpakai bila pencatatan gagal.
 */
export async function ambilNomorSphKso(tx: Tx, now = new Date()): Promise<string> {
  const [p] = await tx`
    SELECT kode_tengah, nomor_berikutnya, reset_tahunan, tahun_berjalan FROM public.sph_pengaturan WHERE id = 1 FOR UPDATE`;
  if (!p) throw new Error("NOMOR_SPH_BELUM_DIATUR");
  const t = tanggalWib(now);
  const { dipakai, sesudah } = ambilNomor(
    {
      nomorBerikutnya: Number(p.nomor_berikutnya),
      resetTahunan: p.reset_tahunan === true,
      tahunBerjalan: p.tahun_berjalan == null ? null : Number(p.tahun_berjalan),
    },
    t.tahun,
  );
  await tx`UPDATE public.sph_pengaturan SET nomor_berikutnya = ${sesudah.nomorBerikutnya}, tahun_berjalan = ${sesudah.tahunBerjalan}
           WHERE id = 1`;
  return formatNomorSph(dipakai, String(p.kode_tengah), t.bulan, t.tahun);
}

/** Direktur yang memutus rencana ini (null untuk zona AM/HOD). Dibaca di transaksi peran (RLS boleh_lihat). */
export async function pemutusDireksi(tx: Tx, id: number): Promise<string | null> {
  const [r] = await tx`select oleh_user from kso.putusan_direksi_catatan where rencana_id = ${id} order by at desc limit 1`;
  return r?.oleh_user ? String(r.oleh_user) : null;
}

/** Terbitkan SPH KSO untuk rencana yang baru saja PENAWARAN_TERBIT. Mengembalikan {id, nomor}. */
export async function terbitkanSphKso(
  tx: Tx,
  id: number,
  harga: number,
  kandidat: KandidatTtdKso[],
  pilihan: string | null | undefined,
): Promise<{ id: number; nomor: string; ttd_nama: string }> {
  const t = pilihTtdKso(kandidat, pilihan, await pemutusDireksi(tx, id));
  if (!t.ok) throw new Error(`PENANDA_TANGAN_SPH: ${t.error}`);
  const nomor = await ambilNomorSphKso(tx);
  const [r] = await tx`select kso.app_catat_sph(${id}, ${nomor}, ${harga}, ${t.ttd.userId}, ${t.ttd.nama}, ${t.ttd.jabatan},
                                               ${SPH_KSO_BERLAKU_HARI})::int as sid`;
  return { id: Number(r.sid), nomor, ttd_nama: t.ttd.nama };
}

export async function daftarSphKso(tx: Tx, id: number): Promise<SphKso[]> {
  return (await tx.unsafe(`select ${KOLOM_SPH_KSO} from kso.sph where rencana_id = $1 order by terbit_at desc, id desc`, [id])) as unknown as SphKso[];
}
