// Hak akses Proyek HD (/proyek-hd) — tracker proyek hemodialisa + Simulator HD.
//
// MENU   — fitur 'proyek-hd' di matriks Akses Grup: lihat = dashboard, detail, tab
//   Proyeksi RS; buat = tambah proyek; ubah = catatan tahap, maju tahap, unit/RAG,
//   simpan simulasi. Fitur BARU default TERTUTUP (Sync Fitur menyemai baris deny) —
//   sebelum matriks diatur hanya admin/superuser yang lolos lewat canOrLegacy.
// MARGIN — kunci 'proyek-hd-margin': tab Margin WRG (harga consumable/mesin, biaya,
//   margin) + parameter margin_*. Bahan keputusan Business HOD/Komite/Direksi —
//   JANGAN dicentang untuk AM, Sales HOD, atau Admin Sales. Disaring di BFF, bukan UI.
// PARAMETER — ubah nilai default (tarif, harga) = admin/superuser atau pemegang
//   'proyek-hd-margin' dengan aksi ubah.

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "proyek-hd";
export const FITUR_MARGIN = "proyek-hd-margin";

export function canViewProyekHd(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, false);
}

export function canLihatMarginHd(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR_MARGIN, false);
}

export function canAturParamHd(u?: (AccessUser & { superuser?: boolean | null }) | null): boolean {
  if (!u) return false;
  return u.role === "admin" || u.superuser === true || canOrLegacy(u, FITUR_MARGIN, false, "edit");
}
