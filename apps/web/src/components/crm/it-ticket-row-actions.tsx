"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Ticket {
  id: string;
  asset_code: string;
  status: string;
  assigned_to: string | null;
}

export function ItTicketRowActions({ ticket }: { ticket: Ticket }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    status: ticket.status,
    assigned_to: ticket.assigned_to ?? "",
    resolved_note: "",
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-tickets/${ticket.id}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: f.status,
          assigned_to: f.assigned_to.trim() || undefined,
          resolved_note: f.resolved_note.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Ubah status" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Update tiket — {ticket.asset_code}</DialogTitle>
          <DialogDescription>Ubah status, tugaskan PIC, atau catat penyelesaian.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="it-status">Status</Label>
              <select
                id="it-status"
                className={selectCls}
                value={f.status}
                disabled={ticket.status === "resolved"}
                onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}
              >
                <option value="open">Baru</option>
                <option value="in_progress">Dikerjakan</option>
                <option value="resolved">Selesai</option>
              </select>
              {ticket.status === "resolved" && (
                <p className="text-muted-foreground text-xs">Tiket sudah selesai — status tidak bisa ditarik mundur.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="it-pic">PIC</Label>
              <Input id="it-pic" value={f.assigned_to} onChange={(e) => setF((p) => ({ ...p, assigned_to: e.target.value }))} />
            </div>
            {f.status === "resolved" && (
              <div className="grid gap-1.5">
                <Label htmlFor="it-note">Catatan penyelesaian</Label>
                <Textarea id="it-note" value={f.resolved_note} onChange={(e) => setF((p) => ({ ...p, resolved_note: e.target.value }))} placeholder="opsional" />
              </div>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
