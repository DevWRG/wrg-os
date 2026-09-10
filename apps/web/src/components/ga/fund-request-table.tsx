"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupiah } from "@/lib/pricelist";
import { type ApproverRole } from "@/lib/fund-request-access";

export type FundRequestStatus = "pending_hod" | "pending_direktur" | "approved" | "rejected";

export interface FundRequestRow {
  id: string;
  requester_name: string;
  requester_email: string;
  purpose: string;
  amount_requested: number;
  cabang: string | null;
  request_date: string;
  hod_approver_key: string;
  notes: string | null;
  approval_status: FundRequestStatus;
}

interface ApprovalRow {
  approver_role: ApproverRole;
  status: "pending" | "approved" | "rejected";
  decided_by: string | null;
  decided_at: string | null;
  note: string | null;
}

interface Detail extends FundRequestRow {
  approvals: ApprovalRow[];
  my_roles: ApproverRole[];
  can_cancel: boolean;
}

const ROLE_LABEL: Record<ApproverRole, string> = { hod: "HOD", direktur: "Direktur" };
const ROLE_ORDER: ApproverRole[] = ["hod", "direktur"];

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

function StatusBadge({ status }: { status: FundRequestStatus }) {
  if (status === "approved") return <Badge className="bg-success/10 text-success">Disetujui</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Ditolak</Badge>;
  if (status === "pending_direktur") return <Badge className="bg-warning/10 text-warning">Menunggu Direktur</Badge>;
  return <Badge className="bg-warning/10 text-warning">Menunggu HOD</Badge>;
}

function ApprovalDecisionBadge({ status }: { status: ApprovalRow["status"] }) {
  if (status === "approved") return <Badge className="bg-success/10 text-success">Approved</Badge>;
  if (status === "rejected") return <Badge variant="destructive">Ditolak</Badge>;
  return <Badge variant="outline">Menunggu</Badge>;
}

const columns: DataColumn<FundRequestRow>[] = [
  { id: "purpose", header: "Keperluan", sortable: true, accessor: (r) => r.purpose, cell: (r) => <span className="font-medium">{r.purpose}</span> },
  { id: "requester_name", header: "Pengaju", sortable: true, accessor: (r) => r.requester_name },
  { id: "amount_requested", header: "Jumlah", sortable: true, accessor: (r) => r.amount_requested, cell: (r) => <span className="tabular-nums">{formatRupiah(r.amount_requested)}</span> },
  { id: "request_date", header: "Tgl Pengajuan", sortable: true, accessor: (r) => r.request_date, cell: (r) => <span className="whitespace-nowrap">{tgl(r.request_date)}</span> },
  { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => <span className="text-muted-foreground">{r.cabang ?? "—"}</span> },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.approval_status} /> },
];

export function FundRequestTable({ rows }: { rows: FundRequestRow[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<FundRequestRow | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<ApproverRole | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  function openDetail(r: FundRequestRow) {
    setSel(r);
    setDetail(null);
    setDetailErr(false);
    setRejecting(null);
    setRejectNote("");
    setApprovalError(null);
    setActionError(null);
    reload(r.id);
  }

  async function errorMessage(res: Response): Promise<string> {
    const data = await res.json().catch(() => null);
    return (data && typeof data.error === "string" && data.error) || `Gagal (HTTP ${res.status})`;
  }

  function reload(id: string) {
    fetch(`/api/fund-requests/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Detail) => setDetail(d))
      .catch(() => setDetailErr(true));
  }

  async function decideApproval(role: ApproverRole, decision: "approve" | "reject", note?: string) {
    if (!sel) return;
    setBusy(true);
    setApprovalError(null);
    try {
      const res = await fetch(`/api/fund-requests/${sel.id}/approvals`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role, decision, note: note || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "gagal memproses approval");
      setRejecting(null);
      setRejectNote("");
      reload(sel.id);
      router.refresh();
    } catch (err) {
      setApprovalError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  function cancelFundRequest() {
    if (!sel) return;
    confirm(
      { title: "Batalkan pengajuan?", description: `Pengajuan "${sel.purpose}" akan dibatalkan.`, destructive: true, confirmLabel: "Batalkan" },
      async () => {
        setBusy(true);
        setActionError(null);
        try {
          const res = await fetch(`/api/fund-requests/${sel.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error(await errorMessage(res));
          setSel(null);
          router.refresh();
        } catch (err) {
          setActionError(String(err instanceof Error ? err.message : err));
        } finally {
          setBusy(false);
        }
      },
    );
  }

  return (
    <>
      {dialog}
      <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari keperluan / pengaju / cabang…" pageSize={25} onRowClick={openDetail} />

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent>
          {sel && (
            <>
              <DialogHeader>
                <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Pengajuan Dana Operasional</div>
                <DialogTitle>{sel.purpose}</DialogTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{sel.requester_name} · {tgl(sel.request_date)}</span>
                  <StatusBadge status={(detail ?? sel).approval_status} />
                </div>
              </DialogHeader>
              <DialogBody className="space-y-4 text-sm">
                {detailErr ? (
                  <div className="text-muted-foreground py-1 text-xs">Gagal memuat detail.</div>
                ) : !detail ? (
                  <div className="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                    <Loader2 className="size-3.5 animate-spin" /> Memuat pengajuan…
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Jumlah</Label>
                        <div className="tabular-nums">{formatRupiah(detail.amount_requested)}</div>
                      </div>
                      <div className="min-w-0">
                        <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Cabang</Label>
                        <div>{detail.cabang ?? "—"}</div>
                      </div>
                    </div>

                    <div>
                      <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Approval</div>
                      <ul className="divide-border divide-y rounded-lg border">
                        {ROLE_ORDER.map((role) => {
                          const row = detail.approvals.find((a) => a.approver_role === role);
                          const canAct = detail.my_roles.includes(role) && row?.status === "pending" && detail.approval_status !== "rejected";
                          return (
                            <li key={role} className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <div>{ROLE_LABEL[role]}</div>
                                  {row?.decided_by && (
                                    <div className="text-muted-foreground text-xs">
                                      {row.status === "approved" ? "Disetujui" : "Ditolak"} oleh {row.decided_by}
                                      {row.decided_at ? ` · ${tgl(row.decided_at)}` : ""}
                                      {row.note ? ` — ${row.note}` : ""}
                                    </div>
                                  )}
                                </div>
                                <ApprovalDecisionBadge status={row?.status ?? "pending"} />
                                {canAct && rejecting !== role && (
                                  <>
                                    <Button type="button" size="sm" disabled={busy} onClick={() => decideApproval(role, "approve")}>Approve</Button>
                                    <Button type="button" size="sm" variant="outline" disabled={busy} className="text-danger hover:text-danger" onClick={() => setRejecting(role)}>Reject</Button>
                                  </>
                                )}
                              </div>
                              {canAct && rejecting === role && (
                                <div className="mt-2 space-y-2">
                                  <Textarea
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                    placeholder="Alasan reject (opsional)"
                                    className="text-sm"
                                  />
                                  <div className="flex gap-2">
                                    <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => decideApproval(role, "reject", rejectNote)}>
                                      Konfirmasi Reject
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setRejecting(null); setRejectNote(""); }}>
                                      Batal
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      {approvalError && <p className="text-destructive mt-2 text-xs">{approvalError}</p>}
                    </div>

                    {detail.notes && (
                      <div>
                        <div className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Catatan</div>
                        <div>{detail.notes}</div>
                      </div>
                    )}
                  </>
                )}
              </DialogBody>
              {actionError && <p className="text-destructive px-4 pb-2 text-xs">{actionError}</p>}
              {detail?.can_cancel && detail.approval_status === "pending_hod" && (
                <DialogFooter>
                  <Button type="button" variant="ghost" disabled={busy} onClick={cancelFundRequest} className="text-danger hover:text-danger">
                    <Trash2 /> Batalkan Pengajuan
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
