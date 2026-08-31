"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserMinus, ArrowLeftRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export interface AppUserOption { id: string; name: string | null }

const NONE = "__none__"; // sentinel Select "belum pilih" — bukan "" krn Base UI Select tak suka value kosong

function UserOrNamePicker({ users, userId, setUserId, picName, setPicName, label }: {
  users: AppUserOption[]; userId: string; setUserId: (v: string) => void;
  picName: string; setPicName: (v: string) => void; label: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <Select value={userId || NONE} onValueChange={(v) => setUserId(v === NONE ? "" : (v ?? ""))}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Pilih user terdaftar">{(v: string) => (v === NONE ? "Pilih user terdaftar" : users.find((u) => u.id === v)?.name ?? v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— tidak pilih —</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name ?? u.id}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">Atau kalau belum terdaftar, isi nama bebas (tanpa histori):</p>
      <Input value={picName} onChange={(e) => setPicName(e.target.value)} placeholder="Nama bebas, opsional" disabled={!!userId} />
    </div>
  );
}

export function AssignAssetButton({ assetId, users }: { assetId: string; users: AppUserOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [picName, setPicName] = useState("");
  const [department, setDepartment] = useState("");
  const [notes, setNotes] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-assets/${assetId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: userId || undefined, pic_name: picName.trim() || undefined, department: department.trim() || undefined, notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal assign");
      setOpen(false);
      setUserId(""); setPicName(""); setDepartment(""); setNotes("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Assign PIC" />}>
        <UserPlus />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign PIC</DialogTitle>
          <DialogDescription>Tercatat di histori kalau PIC-nya user terdaftar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <UserOrNamePicker users={users} userId={userId} setUserId={setUserId} picName={picName} setPicName={setPicName} label="PIC" />
            <div className="grid gap-1.5">
              <Label htmlFor="asg-dept">Departemen</Label>
              <Input id="asg-dept" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asg-notes">Catatan</Label>
              <Textarea id="asg-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Assign"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReturnAssetButton({ assetId }: { assetId: string }) {
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
      const res = await fetch(`/api/ga-assets/${assetId}/return`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal return");
      setOpen(false);
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Return (lepas PIC)" />}>
        <UserMinus />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Return aset</DialogTitle>
          <DialogDescription>Lepas PIC aktif dari aset ini.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ret-notes">Catatan</Label>
              <Textarea id="ret-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Return"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TransferAssetButton({ assetId, users }: { assetId: string; users: AppUserOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [picName, setPicName] = useState("");
  const [toLocation, setToLocation] = useState("");
  const [reason, setReason] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-assets/${assetId}/transfer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_user_id: userId || undefined, to_pic_name: picName.trim() || undefined, to_location: toLocation.trim() || undefined, reason: reason.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal transfer");
      setOpen(false);
      setUserId(""); setPicName(""); setToLocation(""); setReason("");
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" variant="outline" title="Transfer PIC/lokasi" />}>
        <ArrowLeftRight />
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Transfer aset</DialogTitle>
          <DialogDescription>Pindah PIC dan/atau lokasi. PIC baru wajib user terdaftar.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <UserOrNamePicker users={users} userId={userId} setUserId={setUserId} picName={picName} setPicName={setPicName} label="PIC Baru" />
            <div className="grid gap-1.5">
              <Label htmlFor="tr-loc">Lokasi Baru</Label>
              <Input id="tr-loc" value={toLocation} onChange={(e) => setToLocation(e.target.value)} placeholder="opsional, kosongkan kalau tak berubah" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tr-reason">Alasan</Label>
              <Textarea id="tr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || (!userId && !picName.trim())}>{busy ? "Menyimpan…" : "Transfer"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
