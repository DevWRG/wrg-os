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
const blank = () => ({ vendor_name: "", po_number: "", item_desc: "", qty: "", eta_date: today(), cabang: "", notes: "" });

interface VendorOpt {
  id: string;
  name: string | null;
}

export function AddSupplierEtaSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [vendors, setVendors] = useState<VendorOpt[]>([]);

  useEffect(() => {
    if (!open || vendors.length > 0) return;
    void fetch("/api/vendors", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVendors(d?.rows ?? []))
      .catch(() => {});
  }, [open, vendors.length]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/supplier-eta", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor_name: f.vendor_name.trim(),
          po_number: f.po_number.trim() || undefined,
          item_desc: f.item_desc.trim(),
          qty: f.qty.trim() ? Number(f.qty) : undefined,
          eta_date: f.eta_date,
          cabang: f.cabang.trim() || undefined,
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
        <Plus /> Tambah ETA
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Supplier ETA</SheetTitle>
          <SheetDescription>Catat estimasi tanggal barang datang dari supplier (F39).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="se-vendor">Supplier *</Label>
              <Input id="se-vendor" list="se-vendors" required value={f.vendor_name} onChange={(e) => setF((p) => ({ ...p, vendor_name: e.target.value }))} placeholder="Nama supplier" />
              <datalist id="se-vendors">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name ?? ""} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-po">No. PO / Referensi</Label>
              <Input id="se-po" value={f.po_number} onChange={(e) => setF((p) => ({ ...p, po_number: e.target.value }))} placeholder="PO-2026-0001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-item">Barang *</Label>
              <Input id="se-item" required value={f.item_desc} onChange={(e) => setF((p) => ({ ...p, item_desc: e.target.value }))} placeholder="Deskripsi barang yang ditunggu" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="se-qty">Qty</Label>
                <Input id="se-qty" type="number" min="0" step="any" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="se-eta">ETA *</Label>
                <Input id="se-eta" type="date" required value={f.eta_date} onChange={(e) => setF((p) => ({ ...p, eta_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-cabang">Cabang tujuan</Label>
              <Input id="se-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="se-notes">Catatan</Label>
              <Textarea id="se-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
