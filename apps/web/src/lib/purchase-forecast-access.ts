// F41 Forecast vs Actual PO Gap Report — bacaan gap anggaran/rencana pembelian
// vs realisasi PO, role min Management di board (17-Onboarding-Magang/
// MAGANG-FEATURES.md). Gate identitas: Direktur + HoD + admin (+ superuser) —
// pola persis canViewPricebookSummary (pricebook-access.ts), BUKAN
// executive-access.ts (fitur ini laporan Purchasing biasa, bukan dashboard
// eksekutif/RBAC/OKR yang off-limits ONBOARDING.md §2). HoD dikenali dari
// `is_hod` (app_user.hod_key ter-set) ATAU title berawalan "hod" (tidak semua
// HoD Business punya hod_key — sama alasan pricebook-access.ts).

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

export function canViewPurchaseForecast(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = norm(u.role);
  const legacy = r === "direktur" || r === "admin" || u.superuser === true
    || u.is_hod === true || norm(u.title).startsWith("hod");
  return canOrLegacy(u, "purchase-forecast", legacy);
}
