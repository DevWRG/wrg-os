// Hak akses Klasifikasi Produk (kode KK.PP.CC.SSS.NNNN, migrasi 072).
//
// LIHAT  — siapa pun yang berizin fitur 'klasifikasi-produk'. Isinya taxonomy +
//   kode produk; tidak ada angka harga sama sekali, jadi tak perlu ditutup
//   seketat price book.
// TULIS  — HoD Business / Purchasing / admin. Menambah node taxonomy atau
//   menerbitkan kode itu tindakan yang tidak bisa dibatalkan dengan bersih:
//   kode produk ikut masuk Accurate dan menempel di transaksi.
//
// Seperti gate lain: matriks Akses Grup menang atas gate identitas untuk LIHAT
// (canOrLegacy); hak TULIS murni jabatan — itu kapabilitas, bukan visibilitas.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "klasifikasi-produk";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();
const isAdmin = (u?: AccessUser | null): boolean => norm(u?.role) === "admin";

export function canViewKlasifikasi(u?: AccessUser | null): boolean {
  return canOrLegacy(u, FITUR, !!u);
}

export function canEditKlasifikasi(u?: AccessUser | null): boolean {
  if (!u) return false;
  const t = norm(u.title);
  return isAdmin(u) || u.superuser === true || t === "hod business" || t === "purchasing";
}
