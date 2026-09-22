// F60 — tipe bersama komponen Audit Findings (pola sama cashin-types.ts).

export interface AuditFinding {
  id: string;
  kode: string;
  title: string;
  description: string | null;
  source: string | null;
  unit_terdampak: string | null;
  control_linkage: string | null;
  due_date: string | null;
  status: "open" | "in_progress" | "pending_closure" | "closed";
  created_by_name: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface ApprovalStep {
  id: number;
  urutan: number;
  label: string;
  accessGroupId: number | null;
  accessGroupName: string | null;
  status: "pending" | "approved" | "rejected" | "skipped";
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface ApprovalRequestDetail {
  id: string;
  findingId: string;
  requestedByName: string | null;
  requestedAt: string;
  status: "pending" | "approved" | "rejected" | "canceled";
  currentUrutan: number;
  steps: ApprovalStep[];
}

export interface ChainConfigRow {
  urutan: number;
  label: string;
  accessGroupId: number | null;
  accessGroupName: string | null;
  enabled: boolean;
}

export interface AccessGroupOption {
  id: number;
  key: string;
  name: string;
}

export const STATUS_LABEL: Record<AuditFinding["status"], string> = {
  open: "Open",
  in_progress: "In Progress",
  pending_closure: "Menunggu Persetujuan",
  closed: "Closed",
};

export const STATUS_VARIANT: Record<AuditFinding["status"], "outline" | "secondary" | "destructive"> = {
  open: "destructive",
  in_progress: "secondary",
  pending_closure: "secondary",
  closed: "outline",
};
