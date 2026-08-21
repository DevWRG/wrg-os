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
const blank = () => ({
  po_number: "",
  vendor_id: "",
  vendor_name: "",
  order_date: today(),
  eta_date: "",
  cabang: "",
  pic: "",
  notes: "",
  item_desc: "",
  qty_ordered: "",
  unit: "",
});

interface VendorOpt {
  id: string;
  name: string | null;
}

// Header PO dibuat di sini + 1 barang awal (wajib minimal 1 item per PO).
// Barang tambahan / log barang masuk dicatat lewat Dialog detail
// (PurchaseOrderTable) setelah PO dibuat — pola sama dana-ops (header dulu,
// item nested ditambah kemudian).
export function AddPurchaseOrderSheet() {
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

  function pickVendor(name: string) {
    const match = vendors.find((v) => v.name === name);
    setF((p) => ({ ...p, vendor_name: name, vendor_id: match ? match.id : "" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          po_number: f.po_number.trim(),
          vendor_id: f.vendor_id || undefined,
          vendor_name: f.vendor_name.trim(),
          order_date: f.order_date,
          eta_date: f.eta_date || undefined,
          cabang: f.cabang.trim() || undefined,
          pic: f.pic.trim() || undefined,
          notes: f.notes.trim() || undefined,
          items: [{ item_desc: f.item_desc.trim(), qty_ordered: Number(f.qty_ordered), unit: f.unit.trim() || undefined }],
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
        <Plus /> Tambah PO
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah PO</SheetTitle>
          <SheetDescription>Catat pesanan pembelian ke vendor (F13) — barang lain & barang masuk dicatat lewat detail PO.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="po-number">No. PO *</Label>
              <Input id="po-number" required value={f.po_number} onChange={(e) => setF((p) => ({ ...p, po_number: e.target.value }))} placeholder="PO-2026-0001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po-vendor">Vendor *</Label>
              <Input id="po-vendor" list="po-vendors" required value={f.vendor_name} onChange={(e) => pickVendor(e.target.value)} placeholder="Nama vendor" />
              <datalist id="po-vendors">
                {vendors.map((v) => (
                  <option key={v.id} value={v.name ?? ""} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="po-order-date">Tgl Order *</Label>
                <Input id="po-order-date" type="date" required value={f.order_date} onChange={(e) => setF((p) => ({ ...p, order_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="po-eta">ETA</Label>
                <Input id="po-eta" type="date" value={f.eta_date} onChange={(e) => setF((p) => ({ ...p, eta_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po-cabang">Cabang tujuan</Label>
              <Input id="po-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po-pic">PIC</Label>
              <Input id="po-pic" value={f.pic} onChange={(e) => setF((p) => ({ ...p, pic: e.target.value }))} placeholder="Yang mengurus PO ini" />
            </div>

            <div className="border-t pt-3">
              <div className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">Barang pertama</div>
              <div className="grid gap-1.5">
                <Label htmlFor="po-item">Barang *</Label>
                <Input id="po-item" required value={f.item_desc} onChange={(e) => setF((p) => ({ ...p, item_desc: e.target.value }))} placeholder="Deskripsi barang yang dipesan" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="po-qty">Qty *</Label>
                  <Input id="po-qty" type="number" min="0" step="any" required value={f.qty_ordered} onChange={(e) => setF((p) => ({ ...p, qty_ordered: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="po-unit">Satuan</Label>
                  <Input id="po-unit" value={f.unit} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="pcs, box, dus…" />
                </div>
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="po-notes">Catatan</Label>
              <Textarea id="po-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
