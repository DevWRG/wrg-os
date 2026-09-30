"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BackupPicField, type BackupUser } from "@/components/crm/backup-pic-field";

export interface PendingLeave {
  id: number;
  am_id: string;
  nama: string;
  jenis: string;
  start_date: string;
  end_date: string;
  status: string;
}

const tgl = (s: string) => {
  const d = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

export function PendingLeaveTable({ pending, users }: { pending: PendingLeave[]; users: BackupUser[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  // F55 — approve lewat dialog supaya pengganti (backup PIC) bisa dipilih.
  const [sel, setSel] = useState<PendingLeave | null>(null);
  const [backup, setBackup] = useState("");
  const [error, setError] = useState<string | null>(null);

  function openApprove(p: PendingLeave) {
    setSel(p);
    setBackup("");
    setError(null);
  }

  async function approve(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return;
    setBusy(sel.id);
    setError(null);
    try {
      const res = await fetch(`/api/leave/pending/${sel.id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve: true, backup_am_id: backup || null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? String(res.status));
      setSel(null);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: number) {
    setBusy(id);
    try {
      const res = await fetch(`/api/leave/pending/${id}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approve: false }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Gagal: ${j.error ?? res.status}`);
      } else {
        router.refresh();
      }
    } catch {
      alert("Gagal menghubungi server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-muted-foreground border-b">
          <tr className="text-left">
            <th className="py-2 pr-3">Nama</th>
            <th className="py-2 pr-3">Jenis</th>
            <th className="py-2 pr-3">Tanggal</th>
            <th className="py-2 pr-3 text-right">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((p) => (
            <tr key={p.id} className="border-b last:border-0">
              <td className="py-2 pr-3 font-medium">{p.nama}</td>
              <td className="py-2 pr-3"><Badge variant="secondary">{p.jenis}</Badge></td>
              <td className="py-2 pr-3 text-muted-foreground">
                {p.start_date === p.end_date ? tgl(p.start_date) : `${tgl(p.start_date)} – ${tgl(p.end_date)}`}
              </td>
              <td className="py-2 pr-3">
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => openApprove(p)}>
                    <Check className="size-4" /> Approve
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => reject(p.id)}>
                    <X className="size-4" /> Tolak
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="max-w-md">
          {sel && (
            <form onSubmit={approve}>
              <DialogHeader>
                <DialogTitle>Approve {sel.jenis} — {sel.nama}</DialogTitle>
                <DialogDescription>
                  {sel.start_date === sel.end_date ? tgl(sel.start_date) : `${tgl(sel.start_date)} – ${tgl(sel.end_date)}`}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-3">
                <BackupPicField id={`pl-b-${sel.id}`} users={users} value={backup} onChange={setBackup} excludeAmId={sel.am_id} jenis={sel.jenis} />
                {error && <p className="text-destructive text-sm">{error}</p>}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSel(null)}>Batal</Button>
                <Button type="submit" disabled={busy === sel.id}>
                  <Check className="size-4" /> {busy === sel.id ? "Menyimpan…" : "Approve"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
