// Hak akses F48 PMF Scorecard (/pmf-scorecard).
//
// Keputusan Direktur 15 Okt 2026: HoD Sales + Direktur saja, izin SENDIRI, default tertutup.
// Dibaca dari pipeline CRM (deal) — bukan konsumsi umum karyawan. Fitur BARU default TERTUTUP:
// Sync Fitur menyemai izin deny untuk semua grup; Direktur & HoD Sales dicentang di Akses Grup
// (admin/superuser lolos lewat canOrLegacy). Fallback identitas sengaja `false`.

import { canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewPmfScorecard(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "pmf-scorecard", false);
}
