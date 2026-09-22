"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { STATUS_LABEL, STATUS_VARIANT, type AuditFinding, type ApprovalRequestDetail } from "./audit-findings-types";

interface DetailResponse {
  finding: AuditFinding;
  activeRequest: ApprovalRequestDetail | null;
  canManage: boolean;
  canDecideCurrentStep: boolean;
}

const STEP_VARIANT: Record<string, "outline" | "secondary" | "destructive"> = {
  approved: "outline", rejected: "destructive", pending: "secondary", skipped: "outline",
};

export function AuditFindingDetailDialog({ findingId, kode }: { findingId: string; kode: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/audit-findings/${findingId}`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "gagal memuat");
      setData(d);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }

  async function action(url: string, body?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await res.json();
      if (!res.ok || d.ok === false) throw new Error(d.error ?? "gagal memproses");
      setNote("");
      await load();
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const finding = data?.finding ?? null;
  const activeRequest = data?.activeRequest ?? null;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) void load(); else setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>Detail</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{kode}</DialogTitle>
          <DialogDescription>{finding?.title ?? "Memuat…"}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {loading && <p className="text-muted-foreground text-sm">Memuat…</p>}

          {finding && (
            <>
              <div className="grid gap-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  <Badge variant={STATUS_VARIANT[finding.status]}>{STATUS_LABEL[finding.status]}</Badge>
                </div>
                {finding.description && <div><span className="text-muted-foreground">Deskripsi: </span>{finding.description}</div>}
                {finding.source && <div><span className="text-muted-foreground">Sumber: </span>{finding.source}</div>}
                {finding.unit_terdampak && <div><span className="text-muted-foreground">Unit Terdampak: </span>{finding.unit_terdampak}</div>}
                {finding.control_linkage && <div><span className="text-muted-foreground">Control Linkage: </span>{finding.control_linkage}</div>}
                {finding.due_date && <div><span className="text-muted-foreground">Due Date: </span>{finding.due_date}</div>}
              </div>

              {finding.status === "open" && data?.canManage && (
                <Button size="sm" disabled={busy} onClick={() => void action(`/api/audit-findings/${findingId}/start`)}>
                  Mulai Tindak Lanjut
                </Button>
              )}

              {finding.status === "in_progress" && data?.canManage && (
                <Button size="sm" disabled={busy} onClick={() => void action(`/api/audit-findings/${findingId}/request-closure`)}>
                  Ajukan Penutupan
                </Button>
              )}

              {activeRequest && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Chain Approval Penutupan</p>
                  <ol className="space-y-1.5">
                    {activeRequest.steps.map((s) => (
                      <li key={s.id} className="flex items-center justify-between rounded-md border px-2.5 py-1.5 text-sm">
                        <span>{s.urutan}. {s.label}{s.accessGroupName ? ` (${s.accessGroupName})` : ""}</span>
                        <Badge variant={STEP_VARIANT[s.status] ?? "outline"}>{s.status}</Badge>
                      </li>
                    ))}
                  </ol>

                  {activeRequest.status === "pending" && data?.canDecideCurrentStep && (
                    <div className="space-y-2 border-t pt-3">
                      <Textarea placeholder="Catatan (wajib utk reject)" value={note} onChange={(e) => setNote(e.target.value)} />
                      <div className="flex gap-2">
                        <Button
                          size="sm" disabled={busy}
                          onClick={() => void action(`/api/audit-findings/approval-requests/${activeRequest.id}/decide`, { action: "approve", note: note || undefined })}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm" variant="outline" className="text-destructive hover:text-destructive"
                          disabled={busy || !note.trim()}
                          onClick={() => void action(`/api/audit-findings/approval-requests/${activeRequest.id}/decide`, { action: "reject", note })}
                        >
                          Reject
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
