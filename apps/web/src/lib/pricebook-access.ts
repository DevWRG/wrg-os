// Hak akses Price Book (F142). Dua tingkat, sengaja dibedakan:
//
//   KATALOG (+ Di Luar Keagenan) — semua user yang berizin fitur 'pricebook'.
//     Isinya harga jual resmi yang memang untuk dipakai sales di lapangan.
//
//   RINGKASAN — Direktur/admin/superuser saja. Nilai katalog per lini, top brand,
//     dan konsentrasi principal adalah bacaan portofolio, bukan alat jualan.
//     HANDOVER §9 melarang HPP/margin/sub-dealer keluar ke sales; ringkasan ini
//     tidak memuat keempatnya, tapi tetap ditutup karena sifat bacaannya.
//
// Seperti gate lain: matriks Akses Grup menang atas gate identitas (canOrLegacy).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewPricebook(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "pricebook", !!u);
}

export function canViewPricebookSummary(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  return canViewPricebook(u) && (r === "direktur" || r === "admin" || u.superuser === true);
}
