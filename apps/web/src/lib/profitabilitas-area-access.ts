// Hak akses F150 Profitabilitas Area (/profitabilitas-area).
//
// Angka biaya & profit per area sensitif. Pola executive-access.ts:
//   "full" = Direktur / admin / superuser → semua area.
//   "hod"  = pemegang izin dari matriks Akses Grup yang BUKAN Direktur/admin/superuser
//            → hanya cabang di hod_territory miliknya (dibatasi di BFF: route meneruskan
//            ?hod=<hod_key sesi> ke API; tanpa hod_key → 403, tak pernah "semua area").
// Default tertutup: butuh Sync Fitur + centang grup. Sebelum fitur diatur di matriks,
// fallback identitas HANYA Direktur/admin/superuser — HoD TIDAK otomatis melihat menu ini;
// HoD baru terbuka (cabangnya sendiri) setelah grupnya dicentang 'profitabilitas-area'.
// Matriks menang begitu fitur diatur untuk grup si user (termasuk mencabut Direktur).

import { canOrLegacy, type PermBag } from "@/lib/perms";

export const FITUR = "profitabilitas-area";

export type ProfitAccess = "full" | "hod";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
}

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function profitabilitasAccess(u?: AccessUser | null): ProfitAccess | null {
  if (!u) return null;
  const r = norm(u.role);
  const isDirekturAdmin = r === "direktur" || r === "admin" || u.superuser === true;
  if (!canOrLegacy(u, FITUR, isDirekturAdmin)) return null;
  return isDirekturAdmin ? "full" : "hod";
}

export function canViewProfitabilitasArea(u?: AccessUser | null): boolean {
  return profitabilitasAccess(u) !== null;
}
