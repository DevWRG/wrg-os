// F138 Operational Fund Request — hak approve/reject per tier. BEDA dari
// po-approval-access.ts (F35): hod_key di sini GENERIC (HOD departemen mana
// pun, dipilih manual oleh pengaju saat submit — bukan 3 key kanonik khusus
// domain PO/Finance). Direktur = role 'direktur' (pola sama
// executive-access.ts/pricebook-access.ts/po-approval-access.ts). Admin/
// superuser boleh stand-in approve di SEMUA tier (anti-lockout, pola sama
// perms.ts can()).

import { type PermBag } from "@/lib/perms";

export type ApproverRole = "hod" | "direktur";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
}

export interface ApprovableFundRequest {
  hod_approver_key: string;
}

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

// Predicate atas SATU role spesifik — supaya admin/superuser yang eligible
// di >1 tier pada request yang sama tidak salah ke-403 kalau dicek per-role
// dari body request (pola sama canDecideApprovalRole F35).
export function canDecideFundRequestApprovalRole(me: AccessUser | null, fr: ApprovableFundRequest, role: ApproverRole): boolean {
  if (!me) return false;
  if (me.superuser === true || norm(me.role) === "admin") return true;
  if (role === "hod") return !!me.hod_key && me.hod_key === fr.hod_approver_key;
  if (role === "direktur") return norm(me.role) === "direktur";
  return false;
}

export function myApprovableFundRequestRoles(me: AccessUser | null, fr: ApprovableFundRequest): ApproverRole[] {
  const roles: ApproverRole[] = ["hod", "direktur"];
  return roles.filter((role) => canDecideFundRequestApprovalRole(me, fr, role));
}
