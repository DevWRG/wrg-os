// Hak akses F10 Penerbitan Faktur (/penerbitan-faktur).
//
// Kunci izin sendiri ('penerbitan-faktur'): lihat = status, riwayat diam & beban akun; ubah = nama
// akun fakturis + pratinjau WA. Fitur BARU default TERTUTUP — Sync Fitur menyemai baris deny untuk
// semua grup, jadi fallback identitasnya `false` (admin/superuser tetap lolos lewat canOrLegacy).
// Pemakainya Fakturis / SPV Finance / HoD Finance & SC.

import { canOrLegacy } from "@/lib/perms";
import type { AccessUser } from "@/lib/pricelist-access";

export const FITUR = "penerbitan-faktur";

export function canViewPenerbitanFaktur(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canOrLegacy(u, FITUR, false);
}
