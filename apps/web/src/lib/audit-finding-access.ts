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

// Siapa boleh memutus tahap CURRENT sebuah pengajuan penutupan — cermin
// decideStep/decideBlockReason di apps/api supaya tombol Approve/Reject hanya
// muncul kalau API memang akan menerimanya. SENGAJA tanpa jalan pintas admin:
// API selalu mewajibkan keanggotaan grup tahap itu, jadi admin yang bukan
// anggota dulu melihat tombol lalu ditolak. Admin yang perlu memutus cukup
// dimasukkan ke grupnya lewat menu Akses Grup. Balikan null = boleh.
export interface DecideCheckRequest {
  status: string;
  currentUrutan: number;
  requestedBy: string | null;
  steps: { urutan: number; accessGroupId: number | null; decidedBy: string | null }[];
}

export function auditDecideBlockReason(
  me: { id?: string | null; groups?: { id: number }[] } | null | undefined,
  req: DecideCheckRequest | null | undefined,
): string | null {
  if (!me?.id) return "belum login";
  if (!req || req.status !== "pending") return "tidak ada pengajuan yang menunggu keputusan";
  const current = req.steps.find((s) => s.urutan === req.currentUrutan);
  if (!current?.accessGroupId) return "tahap ini belum punya grup approver";
  if (!(me.groups ?? []).some((g) => g.id === current.accessGroupId)) {
    return "bukan anggota grup yang berwenang untuk tahap ini";
  }
  if (req.requestedBy && req.requestedBy === me.id) {
    return "pengaju penutupan tidak boleh ikut memutus pengajuannya sendiri";
  }
  const sudah = req.steps.find((s) => s.urutan !== req.currentUrutan && s.decidedBy === me.id);
  if (sudah) return `sudah memutus tahap ${sudah.urutan} di pengajuan ini — satu orang hanya boleh memutus satu tahap`;
  return null;
}
