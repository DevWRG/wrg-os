"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
// NB: F133 (sibling branch, sama-sama di atas F132) punya tipe identik di
// ga-asset-pic-actions.tsx — didefinisikan ulang di sini krn F137 tak punya
// file itu (bukan turunan F133). Dedup pas merge.
export interface AppUserOption { id: string; name: string | null }

interface Schedule {
  id: string;
  status: string;
  cost_budget: number;
}

const NONE = "__none__";

function StartButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const res = await fetch(`/api/ga-maintenance/${id}/start`, { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" title="Mulai kerjakan" disabled={busy} onClick={run}>
      <Play />
    </Button>
  );
}

function CompleteButton({ id, defaultCost }: { id: string; defaultCost: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costActual, setCostActual] = useState(defaultCost ? String(defaultCost) : "");
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-maintenance/${id}/complete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cost_actual: costActual ? Number(costActual) : undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyelesaikan");
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
      <DialogTrigger render={<Button size="sm" variant="outline" title="Selesaikan" />}>
        <CheckCircle2 />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Selesaikan maintenance</DialogTitle>
          <DialogDescription>Biaya aktual &gt;Rp5jt tanpa approval sebelumnya akan menunggu Finance dulu.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cm-cost">Biaya Aktual (Rp)</Label>
              <Input id="cm-cost" type="number" min={0} value={costActual} onChange={(e) => setCostActual(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cm-notes">Catatan</Label>
              <Textarea id="cm-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Selesai"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CancelButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-maintenance/${id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal membatalkan");
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
      <DialogTrigger render={<Button size="sm" variant="outline" title="Batalkan" />}>
        <XCircle />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Batalkan jadwal maintenance</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="cx-notes">Alasan</Label>
              <Textarea id="cx-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>{busy ? "Membatalkan…" : "Batalkan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Tutup</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// approved_by SELALU diambil dari sesi login di server (route.ts) kalau ada.
// Picker di sini cuma fallback dev (AUTH_ENABLED=false, belum ada sesi).
function ApproveButton({ id, users }: { id: string; users: AppUserOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-maintenance/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved_by: userId || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal approve");
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
      <DialogTrigger render={<Button size="sm" title="Approve Finance" />}>
        <ShieldCheck /> Approve
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Approve Finance</DialogTitle>
          <DialogDescription>Biaya &gt;Rp5jt butuh sign-off Finance sebelum status jadi Selesai.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Disetujui sbg (kosongkan kalau sudah login)</Label>
              <Select value={userId || NONE} onValueChange={(v) => setUserId(v === NONE ? "" : (v ?? ""))}>
                <SelectTrigger>
                  <SelectValue>{(v: string) => (v === NONE ? "— pakai sesi login —" : users.find((u) => u.id === v)?.name ?? v)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— pakai sesi login —</SelectItem>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Approve"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GaMaintenanceActions({ schedule, canApproveFinance, users }: { schedule: Schedule; canApproveFinance: boolean; users: AppUserOption[] }) {
  if (schedule.status === "requested") {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <StartButton id={schedule.id} />
        <CancelButton id={schedule.id} />
      </div>
    );
  }
  if (schedule.status === "in_progress") {
    return (
      <div className="flex items-center justify-end gap-1.5">
        <CompleteButton id={schedule.id} defaultCost={schedule.cost_budget} />
        <CancelButton id={schedule.id} />
      </div>
    );
  }
  if (schedule.status === "pending_finance") {
    return canApproveFinance ? (
      <ApproveButton id={schedule.id} users={users} />
    ) : (
      <Badge variant="destructive">Nunggu Finance</Badge>
    );
  }
  return <span className="text-muted-foreground text-xs">-</span>;
}
