"use client";

import { useState } from "react";
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

const blank = () => ({
  item_desc: "",
  qty: "",
  unit: "",
  cabang_asal: "",
  cabang_tujuan: "",
  reason: "",
  requested_by: "",
  request_date: today(),
  notes: "",
});

export function AddInventoryRelocationSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const qty = Number(f.qty);
      if (!(qty > 0)) throw new Error("qty harus lebih dari 0");
      if (f.cabang_asal.trim() && f.cabang_asal.trim() === f.cabang_tujuan.trim()) {
        throw new Error("cabang asal dan tujuan tidak boleh sama");
      }
      const res = await fetch("/api/inventory-relocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_desc: f.item_desc.trim(),
          qty,
          unit: f.unit.trim() || undefined,
          cabang_asal: f.cabang_asal.trim(),
          cabang_tujuan: f.cabang_tujuan.trim(),
          reason: f.reason.trim() || undefined,
          requested_by: f.requested_by.trim() || undefined,
          request_date: f.request_date || undefined,
          notes: f.notes.trim() || undefined,
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
        <Plus /> Tambah Request
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Request Relokasi</SheetTitle>
          <SheetDescription>Catat permintaan pemindahan barang antar cabang.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="irr-item">Barang *</Label>
              <Input id="irr-item" required value={f.item_desc} onChange={(e) => setF((p) => ({ ...p, item_desc: e.target.value }))} placeholder="Nama/deskripsi barang" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="irr-qty">Qty *</Label>
                <Input id="irr-qty" type="number" min="0.01" step="0.01" required value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="irr-unit">Satuan</Label>
                <Input id="irr-unit" value={f.unit} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="pcs / box / dus" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="irr-asal">Cabang Asal *</Label>
                <Input id="irr-asal" required value={f.cabang_asal} onChange={(e) => setF((p) => ({ ...p, cabang_asal: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="irr-tujuan">Cabang Tujuan *</Label>
                <Input id="irr-tujuan" required value={f.cabang_tujuan} onChange={(e) => setF((p) => ({ ...p, cabang_tujuan: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="irr-date">Tgl Request</Label>
              <Input id="irr-date" type="date" value={f.request_date} onChange={(e) => setF((p) => ({ ...p, request_date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="irr-requested-by">Diminta oleh</Label>
              <Input id="irr-requested-by" value={f.requested_by} onChange={(e) => setF((p) => ({ ...p, requested_by: e.target.value }))} placeholder="Nama HOD" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="irr-reason">Alasan</Label>
              <Input id="irr-reason" value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} placeholder="Mis. stok berlebih di cabang asal" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="irr-notes">Catatan</Label>
              <Textarea id="irr-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
