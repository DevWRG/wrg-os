// Hak akses F40 Inventory Relocation Request. Role min HOD — seluruh halaman
// (bukan cuma "lihat semua" spt Raport) di-gate HOD/admin, krn ini transaksi
// keputusan relokasi barang antar cabang, bukan data pribadi tiap karyawan.
// Pola sama dgn raport-access.ts (canViewRaportList) & dana-ops-access.ts F51.
//
// Begitu fitur 'inventory-relocations' diatur di matriks Akses Grup untuk
// grup si user, matriks yang menentukan (lihat canOrLegacy di lib/perms).

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewInventoryRelocation(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "inventory-relocations", !!u && (norm(u.role) === "admin" || u.superuser === true || u.is_hod === true));
}
