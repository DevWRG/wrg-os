// Hak akses F27 Faktur Pajak / CoreTax (/faktur-pajak).
//
// Kunci izin sendiri ('faktur-pajak'): view = lihat tracker, create = ajukan FP dari invoice,
// edit = geser status (input CoreTax, approve, bukti, batal). Datanya NPWP + nilai PPN customer,
// jadi fitur BARU default TERTUTUP: Sync Fitur menyemai izin deny untuk semua grup, fallback
// identitasnya `false` (admin/superuser lolos lewat canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewFakturPajak(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "faktur-pajak", false);
}

export function canCreateFakturPajak(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "faktur-pajak", false, "create");
}

export function canEditFakturPajak(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "faktur-pajak", false, "edit");
}
