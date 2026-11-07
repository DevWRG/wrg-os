// Hak akses F150 Profitabilitas Area (/profitabilitas-area).
//
// Angka biaya & profit per area sensitif. Pola executive-access.ts:
//   "full" = Direktur / admin / superuser → semua area.
//   "hod"  = HoD (punya hod_key)          → hanya cabang di hod_territory miliknya
//            (dibatasi di BFF: route meneruskan ?hod=<hod_key sesi> ke API).
// Matriks Akses Grup menang begitu fitur 'profitabilitas-area' diatur untuk grup si
// user; izin dari matriks tanpa identitas Direktur/HoD → level "hod" (subset teraman).
// Default tertutup: butuh Sync Fitur + centang grup; sebelum itu fallback identitas.

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
  const identity: ProfitAccess | null = r === "direktur" || r === "admin" || u.superuser === true ? "full" : u.hod_key ? "hod" : null;
  if (!canOrLegacy(u, FITUR, identity !== null)) return null;
  return identity ?? "hod";
}

export function canViewProfitabilitasArea(u?: AccessUser | null): boolean {
  return profitabilitasAccess(u) !== null;
}
