// Hak akses F60 Komite Audit Findings Tracker — domain post-fraud/governance
// (board Roadmap #2, card F60), fallback identitas SENGAJA sempit (admin/
// direktur/superuser saja) selama grup belum diatur di Akses Grup — beda dari
// fitur operasional biasa yang fallback ke "semua Karyawan boleh lihat".
// Chain-config (siapa jadi approver tiap layer) dipisah lebih ketat lagi:
// murni admin/direktur, TIDAK bisa dilonggarkan lewat Akses Grup — mengatur
// approver adalah kapabilitas keamanan, bukan visibilitas menu (pola sama
// canEditPricelistSetup vs canViewPricelist di pricelist-access.ts).

import { canOrLegacy } from "./perms";
import type { AccessUser } from "./pricelist-access";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

const isAdminOrDirektur = (u?: AccessUser | null): boolean =>
  !!u && (norm(u.role) === "admin" || norm(u.role) === "direktur" || u.superuser === true);

export function canViewAuditFindings(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "audit-findings", isAdminOrDirektur(u));
}

export function canCreateAuditFinding(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "audit-findings", isAdminOrDirektur(u), "create");
}

export function canEditAuditFinding(u?: AccessUser | null): boolean {
  return canOrLegacy(u, "audit-findings", isAdminOrDirektur(u), "edit");
}

export function canManageAuditFindingChainConfig(u?: AccessUser | null): boolean {
  return isAdminOrDirektur(u);
}
