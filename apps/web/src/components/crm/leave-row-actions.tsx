"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

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

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface LeaveRow {
  id: string;
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: string;
  keterangan: string | null;
}

export function LeaveRowActions({ row, label }: { row: LeaveRow; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    start_date: row.start_date,
    end_date: row.end_date,
    jenis: row.jenis,
    keterangan: row.keterangan ?? "",
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leave/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          start_date: f.start_date,
          end_date: f.end_date,
          jenis: f.jenis,
          keterangan: f.keterangan.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Hapus cuti ${label} (${row.start_date} → ${row.end_date})?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leave/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("gagal hapus");
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="flex justify-end gap-1">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit cuti — {label}</SheetTitle>
            <SheetDescription>user_leave #{row.id.slice(0, 8)}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`le-jenis-${row.id}`}>Jenis *</Label>
                <select id={`le-jenis-${row.id}`} className={selectCls} value={f.jenis} onChange={(e) => setF((p) => ({ ...p, jenis: e.target.value }))}>
                  <option value="sakit">Sakit</option>
                  <option value="cuti">Cuti</option>
                  <option value="ijin">Izin</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`le-s-${row.id}`}>Mulai *</Label>
                  <Input id={`le-s-${row.id}`} type="date" required value={f.start_date} onChange={(e) => setF((p) => ({ ...p, start_date: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`le-e-${row.id}`}>Selesai *</Label>
                  <Input id={`le-e-${row.id}`} type="date" required value={f.end_date} onChange={(e) => setF((p) => ({ ...p, end_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`le-k-${row.id}`}>Keterangan</Label>
                <Textarea id={`le-k-${row.id}`} value={f.keterangan} onChange={(e) => setF((p) => ({ ...p, keterangan: e.target.value }))} />
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
      <Button variant="ghost" size="icon-sm" aria-label="Hapus" disabled={busy} onClick={del} className="text-danger hover:text-danger">
        <Trash2 />
      </Button>
    </div>
  );
}
