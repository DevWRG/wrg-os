// Hak akses F140 Vendor Management + Contract Expiry Alerts. Role min HOD —
// seluruh halaman di-gate HOD/admin (data kontrak/nilai komersial vendor
// dianggap sensitif, dikonfirmasi user via AskUserQuestion). Pola sama
// raport-access.ts / dana-ops-access.ts / inventory-relocation-access.ts F40.
//
// Begitu fitur 'vendor-management' diatur di matriks Akses Grup untuk grup
// si user, matriks yang menentukan (lihat canOrLegacy di lib/perms).

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewVendorManagement(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "vendor-management", !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true));
}
