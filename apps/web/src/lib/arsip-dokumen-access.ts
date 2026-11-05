// Hak akses F156 Arsip Dokumen (/arsip-dokumen).
//
// MENU — fitur 'arsip-dokumen' di matriks Akses Grup: lihat = telusur & unduh,
//   buat = unggah, ubah = ubah keterangan/rujukan, hapus = tandai terhapus.
//   Fitur BARU default TERTUTUP (Sync Fitur menyemai baris deny) — sebelum
//   matriks diatur hanya admin/superuser yang lolos lewat canOrLegacy.
// KODE BUKU — tambah/ubah/nonaktifkan kode buku hanya admin/superuser: kode
//   melekat di nomor dokumen semua divisi, bukan urusan satu grup.

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "arsip-dokumen";

export function canViewArsipDokumen(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, false);
}

// Sama dengan adalahAdmin di nav.ts — ditulis ulang di sini karena nav.ts mengimpor berkas ini.
export function canAturBukuArsip(u?: (AccessUser & { superuser?: boolean | null }) | null): boolean {
  return u?.role === "admin" || u?.superuser === true;
}
