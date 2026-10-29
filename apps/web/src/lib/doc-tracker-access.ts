// Hak akses DOC Document Tracker (/doc-tracker).
//
// Isinya rantai dokumen per Sales Order (customer, nominal, status kirim/tagih) — bacaan operasional
// Sales Admin/Shipping/Finance. Fallback identitas (selama grup belum punya baris izinnya): role
// direktur / admin / superuser SAJA. Begitu Sync Fitur dijalankan, matriks Akses Grup yang menang
// (canOrLegacy) — jadi Sales Admin/Shipping/Finance dicentang di grupnya setelah Sync Fitur.
// Menstempel Review/Approved & mengisi checklist = aksi `edit` pada fitur ini (feature-guard).

import { can, canOrLegacy } from "@/lib/perms";
import { type AccessUser } from "@/lib/pricelist-access";

export function canViewDocTracker(u?: AccessUser | null): boolean {
  if (!u) return false;
  const r = (u.role ?? "").trim().toLowerCase();
  return canOrLegacy(u, "doc-tracker", r === "direktur" || r === "admin" || u.superuser === true);
}

/** Sama dengan gerbang route (featureAllowed "edit"): belum diatur di matriks = ikut izin lihat. */
export function canEditDocTracker(u?: AccessUser | null): boolean {
  if (!canViewDocTracker(u)) return false;
  return u?.permissions?.["doc-tracker"] ? can(u, "doc-tracker", "edit") : true;
}
