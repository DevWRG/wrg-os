// Hak akses menu Raport. "Raport Saya" (diri sendiri) terbuka utk semua login.
// "Raport Karyawan" (lihat semua) = admin ATAU HoD (app_user.hod_key ter-set →
// is_hod dari /auth/me). Scoping data tetap ditegakkan di BFF + apps/api.

import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewRaportList(u?: AccessUser | null): boolean {
  return !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true);
}
