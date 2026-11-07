// Hak akses F149 DO Belum Difaktur (/do-belum-faktur).
//
// Kunci izin sendiri ('do-belum-faktur'): lihat = daftar & ekspor, ubah = ambang
// hari kerja. Fitur BARU default TERTUTUP — Sync Fitur menyemai baris deny untuk
// semua grup, jadi fallback identitasnya `false` (admin/superuser tetap lolos
// lewat canOrLegacy). Pemakainya Fakturis / SPV Finance / HoD Finance & SC.

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "do-belum-faktur";

export function canViewDoBelumFaktur(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, false);
}
