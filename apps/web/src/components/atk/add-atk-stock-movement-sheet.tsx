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
import type { AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const blank = () => ({
  item_id: "",
  movement_type: "in" as "in" | "out",
  qty: "",
  movement_date: todayIso(),
  reference: "",
  pic: "",
  cabang: "",
  notes: "",
});

export function AddAtkStockMovementSheet({ items }: { items: AtkStockItemOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/atk/stock-movements", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: f.item_id,
          movement_type: f.movement_type,
          qty: Number(f.qty),
          movement_date: f.movement_date || undefined,
          reference: f.reference.trim() || undefined,
          pic: f.pic.trim() || undefined,
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
        <Plus /> Catat Mutasi
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Catat Mutasi Stok ATK</SheetTitle>
          <SheetDescription>Stok masuk (pembelian) atau keluar (pemakaian) barang ATK.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="asm-type">Tipe *</Label>
              <select
                id="asm-type"
                className={selectCls}
                value={f.movement_type}
                onChange={(e) => setF((p) => ({ ...p, movement_type: e.target.value as "in" | "out" }))}
              >
                <option value="in">Masuk</option>
                <option value="out">Keluar</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asm-item">Barang *</Label>
              <select id="asm-item" required className={selectCls} value={f.item_id} onChange={(e) => setF((p) => ({ ...p, item_id: e.target.value }))}>
                <option value="">— Pilih barang —</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id} disabled={!i.is_active}>
                    {i.name} ({i.unit}){i.is_active ? "" : " — nonaktif"}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="asm-qty">Qty *</Label>
                <Input id="asm-qty" type="number" required min="0" step="any" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="asm-date">Tanggal *</Label>
                <Input id="asm-date" type="date" required value={f.movement_date} onChange={(e) => setF((p) => ({ ...p, movement_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asm-ref">Referensi</Label>
              <Input id="asm-ref" value={f.reference} onChange={(e) => setF((p) => ({ ...p, reference: e.target.value }))} placeholder="No. PO / No. permintaan" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="asm-pic">PIC</Label>
                <Input id="asm-pic" value={f.pic} onChange={(e) => setF((p) => ({ ...p, pic: e.target.value }))} placeholder="Diterima/diminta oleh" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="asm-cabang">Cabang</Label>
                <Input id="asm-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="asm-notes">Catatan</Label>
              <Textarea id="asm-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
