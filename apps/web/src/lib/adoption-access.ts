// Hak akses menu Adopsi Fitur (F58). Fitur BARU → tertutup secara default:
//   - Gate lama (belum diatur di matriks Akses Grup): admin/superuser + Direktur SAJA.
//   - HoD TIDAK ikut gate lama; HoD baru bisa membuka setelah dicentang di matriks
//     (lalu apps/api membatasinya ke cabang timnya — audienceOf di repo/adoption.ts).
// Seperti gate lain: begitu fitur punya baris izin di grup user, matriks yang menentukan.

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewAdoption(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  return canOrLegacy(u, "adoption", r === "admin" || r === "direktur" || u.superuser === true);
}
