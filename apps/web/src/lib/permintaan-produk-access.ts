// Hak akses F171 Permintaan Produk Non-Master (/permintaan-produk) — Komite Product Development.
//
// MENU  — fitur 'permintaan-produk' di matriks Akses Grup (tertutup default; Sync Fitur):
//   lihat = log & analisa, buat = catat permintaan, ubah = cek master, kelompokkan, usulan Komite PD.
//   Sebelum matriks diatur: hanya Direktur (+ superuser/admin lewat canOrLegacy).
// PUTUSAN — sub-fitur 'permintaan-produk-putusan' (ubah): putusan Direksi & ambang kandidat.
//   Role admin TIDAK otomatis (keputusan Direktur 20 Okt: role admin juga dipakai HOD);
//   superuser tetap lolos. Sebelum diatur: role direktur.

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "permintaan-produk";
export const FITUR_PUTUSAN = { key: "permintaan-produk-putusan", name: "Permintaan Produk — putusan Direksi & ambang kandidat" };

const direktur = (u: AccessUser) => (u.role ?? "").trim().toLowerCase() === "direktur";

export function canViewPermintaanProduk(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, direktur(u));
}

export function canPutusPermintaan(u?: AccessUser | null): boolean {
  if (!u) return false;
  const v = (u.role ?? "").trim().toLowerCase() === "admin" ? { ...u, role: null } : u;
  return canOrLegacy(v, FITUR_PUTUSAN.key, direktur(u), "edit");
}
