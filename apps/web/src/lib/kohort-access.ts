// Hak akses F96 Cohort & Lead Source (/kohort).
//
// Isinya agregat (kurva retensi customer, pipeline lead per sumber/kuartal/HoD) — bukan data per
// customer/lead. Fallback identitas: Direktur / admin / superuser / HoD (punya hod_key). Matriks
// Akses Grup menang begitu fitur 'kohort' diatur untuk grup si user (canOrLegacy). Default
// tertutup untuk selain itu: butuh Sync Fitur + centang grup.

import { canOrLegacy, type PermBag } from "@/lib/perms";

export const FITUR = "kohort";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
}

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewKohort(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  return canOrLegacy(u, FITUR, r === "direktur" || r === "admin" || u.superuser === true || Boolean(u.hod_key));
}
