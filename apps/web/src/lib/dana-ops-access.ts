// Hak akses menu Dana Ops / Petty Cash Realization (F51) — role min HOD
// (uang operasional, bukan untuk semua Karyawan). admin/superuser selalu
// lolos (anti-lockout); HoD = app_user.hod_key ter-set → is_hod dari /auth/me.
// Scoping/enforcement nyata tetap di BFF (requireHodOrAdmin) + apps/api.

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewDanaOps(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "dana-ops", !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true));
}
