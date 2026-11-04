// Sales Command Center (#1979) — siapa boleh membuka cockpit.
// - "full" = Direktur / admin / superuser → boleh memilih region East/West.
// - "hod"  = punya hod_key → region timnya sendiri (API yang mengunci; HoD non-sales
//   mendapat pesan "cabang tim tidak termasuk region" dari API).
// Matriks Akses Grup menang (canOrLegacy) begitu fitur 'sales-command' diatur untuk
// grup si user — pola yang sama dengan executive-access.ts.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export type SalesCommandAccess = "full" | "hod";
export const FITUR_SALES_COMMAND = "sales-command";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function salesCommandAccess(u?: AccessUser | null): SalesCommandAccess | null {
  if (!u) return null;
  const r = norm(u.role);
  const identity: SalesCommandAccess | null =
    r === "direktur" || r === "admin" || u.superuser === true ? "full" : u.hod_key ? "hod" : null;
  if (!canOrLegacy(u, FITUR_SALES_COMMAND, identity !== null)) return null;
  return identity ?? "hod";
}

export function canViewSalesCommand(u?: AccessUser | null): boolean {
  return salesCommandAccess(u) !== null;
}
