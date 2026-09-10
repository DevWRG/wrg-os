// Hak akses "Approve Finance" — Maintenance GA (F137, cost >Rp5jt butuh
// sign-off). Pola sama pricelist-access.ts (title-based) + matriks Akses
// Grup (feature key 'ga-finance-approval', didaftarkan manual di migrasi
// 089 krn bukan nav item — lihat komentar di sana).

import { canOrLegacy, type PermBag } from "@/lib/perms";

export interface AccessUser extends PermBag {
  title?: string | null;
  role?: string | null;
}

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();
const isAdmin = (u?: AccessUser | null): boolean => norm(u?.role) === "admin";

export function canApproveGaFinance(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "ga-finance-approval", !!u && (isAdmin(u) || norm(u?.title).includes("finance")));
}
