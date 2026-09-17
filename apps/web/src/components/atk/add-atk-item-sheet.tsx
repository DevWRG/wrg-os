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
import type { AtkItemOption } from "@/components/atk/atk-item-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const blank = () => ({
  name: "", unit: "", category_id: "", default_supplier_id: "", min_stock: "", notes: "",
  transaction_category: "barang" as "barang" | "materai",
});

export function AddAtkItemSheet({ categories, suppliers }: { categories: AtkItemOption[]; suppliers: AtkItemOption[] }) {
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
      const res = await fetch("/api/atk/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: f.name.trim(),
          unit: f.unit.trim(),
          category_id: f.category_id || undefined,
          default_supplier_id: f.default_supplier_id || undefined,
          min_stock: f.min_stock.trim() ? Number(f.min_stock) : undefined,
          notes: f.notes.trim() || undefined,
          transaction_category: f.transaction_category,
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
        <Plus /> Tambah Barang
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah Barang ATK</SheetTitle>
          <SheetDescription>Katalog barang ATK (F134) — prasyarat register stok masuk/keluar (F49), termasuk Materai (F54) sbg kategori transaksi.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-name">Nama *</Label>
              <Input id="ai-name" required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="mis. Pulpen Pilot G2" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ai-unit">Satuan *</Label>
                <Input id="ai-unit" required value={f.unit} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="pcs/box/rim" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ai-minstock">Min. Stok</Label>
                <Input id="ai-minstock" type="number" min="0" step="any" value={f.min_stock} onChange={(e) => setF((p) => ({ ...p, min_stock: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-txcat">Kategori Transaksi *</Label>
              <select
                id="ai-txcat"
                className={selectCls}
                value={f.transaction_category}
                onChange={(e) => setF((p) => ({ ...p, transaction_category: e.target.value as "barang" | "materai" }))}
              >
                <option value="barang">Barang</option>
                <option value="materai">Materai</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-cat">Kategori</Label>
              <select id="ai-cat" className={selectCls} value={f.category_id} onChange={(e) => setF((p) => ({ ...p, category_id: e.target.value }))}>
                <option value="">— Tanpa kategori —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-sup">Pemasok Default</Label>
              <select id="ai-sup" className={selectCls} value={f.default_supplier_id} onChange={(e) => setF((p) => ({ ...p, default_supplier_id: e.target.value }))}>
                <option value="">— Tanpa pemasok default —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-notes">Catatan</Label>
              <Textarea id="ai-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
