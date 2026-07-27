// Hak akses menu Raport. "Raport Saya" (diri sendiri) terbuka utk semua login.
// "Raport Karyawan" (lihat semua) = admin ATAU HoD (app_user.hod_key ter-set →
// is_hod dari /auth/me). Scoping data tetap ditegakkan di BFF + apps/api.

// Begitu fitur 'karyawan' diatur di matriks Akses Grup untuk grup si user,
// matriks yang menentukan (lihat canOrLegacy di lib/perms).

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewRaportList(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "karyawan", !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true));
}
