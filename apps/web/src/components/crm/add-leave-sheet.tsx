"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ am_id: "", start_date: today(), end_date: today(), jenis: "sakit", keterangan: "" });
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface UserOpt {
  am_id: string;
  nama: string;
  panggilan: string | null;
}

export function AddLeaveSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [users, setUsers] = useState<UserOpt[]>([]);

  useEffect(() => {
    if (!open || users.length > 0) return;
    void fetch("/api/users?aktif=true", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUsers(d?.users ?? []))
      .catch(() => {});
  }, [open, users.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: f.am_id.trim(),
          start_date: f.start_date,
          end_date: f.end_date,
          jenis: f.jenis,
          keterangan: f.keterangan.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank());
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus /> Tambah cuti
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah cuti / sakit / izin</SheetTitle>
          <SheetDescription>Catat user_leave (mengecualikan dari reminder).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="l-am">Karyawan (am_id) *</Label>
              <Input id="l-am" list="l-users" required value={f.am_id} onChange={(e) => setF((p) => ({ ...p, am_id: e.target.value }))} placeholder="ketik id / pilih" />
              <datalist id="l-users">
                {users.map((u) => (
                  <option key={u.am_id} value={u.am_id}>{u.panggilan ?? u.nama} ({u.am_id})</option>
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-jenis">Jenis *</Label>
              <select id="l-jenis" className={selectCls} value={f.jenis} onChange={(e) => setF((p) => ({ ...p, jenis: e.target.value }))}>
                <option value="sakit">Sakit</option>
                <option value="cuti">Cuti</option>
                <option value="ijin">Izin</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="l-start">Mulai *</Label>
                <Input id="l-start" type="date" required value={f.start_date} onChange={(e) => setF((p) => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="l-end">Selesai *</Label>
                <Input id="l-end" type="date" required value={f.end_date} onChange={(e) => setF((p) => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="l-ket">Keterangan</Label>
              <Textarea id="l-ket" value={f.keterangan} onChange={(e) => setF((p) => ({ ...p, keterangan: e.target.value }))} placeholder="Alasan / catatan…" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
