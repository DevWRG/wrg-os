// Hak akses Executive Command Center (Director Dashboard, F76) berbasis role.
// - "full" = Direktur / admin / superuser → 7 view penuh.
// - "hod"  = HoD (punya hod_key) → subset AC-5: Command (read-only) + AM Radar tim.
// Dipakai sebagai `show` di nav.ts (override RBAC can()) dan guard halaman.

import { type AccessUser } from "@/lib/pricelist-access";

export type ExecAccess = "full" | "hod";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function executiveAccess(u?: AccessUser | null): ExecAccess | null {
  if (!u) return null;
  const r = norm(u.role);
  if (r === "direktur" || r === "admin" || u.superuser === true) return "full";
  if (u.hod_key) return "hod";
  return null;
}

export function canViewExecutive(u?: AccessUser | null): boolean {
  return executiveAccess(u) !== null;
}
