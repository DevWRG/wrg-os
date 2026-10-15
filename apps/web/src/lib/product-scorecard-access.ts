// Hak akses F6 Product Scorecard (/product-scorecard).
//
// LIHAT  — fitur 'product-scorecard' di matriks Akses Grup (tertutup default; butuh
//   Sync Fitur). Sebelum matriks diatur: Direktur + HoD + admin — bacaan portofolio
//   seperti Ringkasan Price Book, bukan alat jualan AM.
// MARGIN — HPP & GP% hanya untuk pembaca HPP: aturan Setup Harga (HoD Business /
//   Purchasing / admin) DITAMBAH Direktur (HPP berasal dari serah terima Direktur).
//   Murni jabatan, bukan centang menu: BFF hanya meminta margin bila lolos di sini.

import { canOrLegacy } from "@/lib/perms";
import { canEditPricelistSetup, type AccessUser } from "@/lib/pricelist-access";

export const FITUR = "product-scorecard";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewProductScorecard(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  const legacy = r === "direktur" || r === "admin" || u.superuser === true
    || u.is_hod === true || norm(u.title).startsWith("hod");
  return canOrLegacy(u, FITUR, legacy);
}

export function canViewMargin(u?: AccessUser | null): boolean {
  if (!u) return false;
  return canEditPricelistSetup(u) || norm(u.role) === "direktur" || u.superuser === true;
}
