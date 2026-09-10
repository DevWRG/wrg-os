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
const blank = () => ({ vendor_name: "", po_number: "", received_date: today(), cabang: "", received_by: "", overall_notes: "" });

interface VendorOpt {
  id: string;
  name: string | null;
}

export function AddInboundReceivingSheet() {
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
      const res = await fetch("/api/inbound-receiving", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor_name: f.vendor_name.trim(),
          po_number: f.po_number.trim() || undefined,
          received_date: f.received_date,
          cabang: f.cabang.trim() || undefined,
          received_by: f.received_by.trim() || undefined,
          overall_notes: f.overall_notes.trim() || undefined,
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
        <Plus /> Barang Datang
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Catat Barang Datang</SheetTitle>
          <SheetDescription>Buat checklist penerimaan barang baru (F36). Poin checklist standar akan dibuat otomatis.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ir-vendor">Supplier *</Label>
              <Input id="ir-vendor" list="ir-vendors" required value={f.vendor_name} onChange={(e) => setF((p) => ({ ...p, vendor_name: e.target.value }))} placeholder="Nama supplier" />
              <datalist id="ir-vendors">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name ?? ""} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ir-po">No. PO / Surat Jalan</Label>
              <Input id="ir-po" value={f.po_number} onChange={(e) => setF((p) => ({ ...p, po_number: e.target.value }))} placeholder="PO-2026-0001" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ir-date">Tgl Terima *</Label>
                <Input id="ir-date" type="date" required value={f.received_date} onChange={(e) => setF((p) => ({ ...p, received_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ir-cabang">Cabang</Label>
                <Input id="ir-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ir-by">Diterima oleh</Label>
              <Input id="ir-by" value={f.received_by} onChange={(e) => setF((p) => ({ ...p, received_by: e.target.value }))} placeholder="Nama penerima" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ir-notes">Catatan</Label>
              <Textarea id="ir-notes" value={f.overall_notes} onChange={(e) => setF((p) => ({ ...p, overall_notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
