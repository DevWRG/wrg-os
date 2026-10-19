// Hak akses F90 Antrean Order (/order-wa).
//
// LIHAT — fitur 'order-wa' di matriks Akses Grup (tertutup default; Sync Fitur). Sebelum
//   matriks diatur: admin/superuser, Direktur, HoD, dan AM (isi tetap ber-scope di API: AM =
//   pesanannya sendiri, HoD = cabangnya). Admin Sales dibuka lewat matriks.
// UBAH STATUS (proses/selesai/batal) — izin edit di matriks; sebelum diatur: admin/superuser saja.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "order-wa";
const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewOrderWa(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  const legacy = r === "admin" || r === "direktur" || u.superuser === true || u.is_hod === true || u.is_am === true || !!u.am_id;
  return canOrLegacy(u, FITUR, legacy);
}
export function canEditOrderWa(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, norm(u.role) === "admin" || u.superuser === true, "edit");
}
