// Hak akses Executive Command Center (Director Dashboard, F76) berbasis role.
// - "full" = Direktur / admin / superuser → 7 view penuh.
// - "hod"  = HoD (punya hod_key) → subset AC-5: Command (read-only) + AM Radar tim.
// Dipakai sebagai `show` di nav.ts dan guard halaman.
//
// Matriks Akses Grup ikut menentukan (canOrLegacy): begitu fitur 'executive'
// diatur untuk grup si user, matriks yang menang. Izin dari matriks tanpa
// identitas Direktur/HoD → level "hod" (subset teraman), bukan "full".

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export type ExecAccess = "full" | "hod";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function executiveAccess(u?: AccessUser | null): ExecAccess | null {
  if (!u) return null;
  const r = norm(u.role);
  const identity: ExecAccess | null =
    r === "direktur" || r === "admin" || u.superuser === true ? "full" : u.hod_key ? "hod" : null;
  if (!canOrLegacy(u, "executive", identity !== null)) return null;
  return identity ?? "hod";
}

export function canViewExecutive(u?: AccessUser | null): boolean {
  return executiveAccess(u) !== null;
}
