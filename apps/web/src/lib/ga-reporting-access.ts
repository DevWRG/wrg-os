// Hak akses menu GA Reporting & Analytics Dashboard (F141) — role min HOD.
// Dashboard ini mengkonsolidasikan data 6 modul GA (F49 ATK+F54 Materai, F50
// Kendaraan, F51 Dana Ops, F52 IT Asset, F53 Stiker Aset); sebagian modul
// sumber terbuka untuk semua Karyawan tapi Dana Ops sudah HOD+ — gate
// konsolidasi ini disamakan dengan yang paling ketat (pola sama dana-ops-access.ts).
// admin/superuser selalu lolos (anti-lockout); HoD = app_user.hod_key ter-set
// → is_hod dari /auth/me. Scoping/enforcement nyata tetap di BFF (requireHodOrAdmin).

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewGaReporting(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "ga-reporting", !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true));
}
