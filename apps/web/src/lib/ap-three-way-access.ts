// Hak akses F152 3-Way Match Faktur Pembelian (/ap-three-way).
//
// Kunci izin sendiri ('ap-three-way'), hanya lihat (fitur read-only: selisih ditandai, penyelesaiannya
// di Accurate). Datanya hutang usaha, jadi default TERTUTUP: Sync Fitur + centang grup Finance/Purchasing;
// sebelum itu fallback identitasnya `false` (admin/superuser lolos lewat canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewApThreeWay(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "ap-three-way", false);
}
