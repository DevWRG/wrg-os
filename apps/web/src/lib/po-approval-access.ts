// F35 PO Approval Workflow — hak approve/reject per tier PO. hod_key kanonik
// (mufid=HoD Business IVD, arman=HoD Business Medical, ika=HoD Finance & SC)
// duplikat dari apps/api/src/hod-resolver.ts (HODS) — tak bisa diimpor lintas
// app, pola duplikasi yang sama dgn HOD_DEFS (watchpoint.ts) vs hod-options.ts.
// Direktur = role 'direktur' (pola sama executive-access.ts/pricebook-access.ts).
// Admin/superuser boleh stand-in approve di SEMUA tier (anti-lockout, pola
// sama perms.ts can()) — mencegah PO macet total kalau HOD terkait berhalangan.

import { type PermBag } from "@/lib/perms";

export type ApproverRole = "hod_business" | "hod_finance" | "direktur";
export type PurchaseOrderLini = "IVD" | "Medical";

export interface AccessUser extends PermBag {
  hod_key?: string | null;
}

export interface ApprovablePo {
  lini: PurchaseOrderLini | null;
}

const LINI_HOD_KEY: Record<PurchaseOrderLini, string> = { IVD: "mufid", Medical: "arman" };
const FINANCE_HOD_KEY = "ika";

const norm = (s?: string | null): string => (s ?? "").trim().toLowerCase();

// Predicate atas SATU role spesifik (bukan "hitung 1 role lalu bandingkan") —
// supaya admin/superuser yang eligible di >1 tier pada PO yang sama tidak
// salah ke-403 kalau dicek per-role dari body request.
export function canDecideApprovalRole(me: AccessUser | null, po: ApprovablePo, role: ApproverRole): boolean {
  if (!me) return false;
  if (me.superuser === true || norm(me.role) === "admin") return true;
  if (role === "hod_business") return po.lini !== null && me.hod_key === LINI_HOD_KEY[po.lini];
  if (role === "hod_finance") return me.hod_key === FINANCE_HOD_KEY;
  if (role === "direktur") return norm(me.role) === "direktur";
  return false;
}

export function myApprovableRoles(me: AccessUser | null, po: ApprovablePo): ApproverRole[] {
  const roles: ApproverRole[] = ["hod_business", "hod_finance", "direktur"];
  return roles.filter((role) => canDecideApprovalRole(me, po, role));
}
