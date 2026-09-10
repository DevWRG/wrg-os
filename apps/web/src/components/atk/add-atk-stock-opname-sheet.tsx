"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";

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
import type { AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

const blank = () => ({
  item_id: "",
  opname_date: todayIso(),
  counted_qty: "",
  counted_by: "",
  cabang: "",
  notes: "",
});

export function AddAtkStockOpnameSheet({ items, levels }: { items: AtkStockItemOption[]; levels: AtkStockLevelRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  const systemQty = useMemo(
    () => levels.find((l) => l.item_id === f.item_id)?.current_stock ?? null,
    [levels, f.item_id]
  );
  const variance = systemQty != null && f.counted_qty !== "" ? Number(f.counted_qty) - systemQty : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/atk/stock-opname", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: f.item_id,
          counted_qty: Number(f.counted_qty),
          opname_date: f.opname_date || undefined,
          counted_by: f.counted_by.trim() || undefined,
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
        <ListChecks /> Catat Opname
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Catat Hasil Opname ATK</SheetTitle>
          <SheetDescription>
            Hitung fisik barang, bandingkan dgn stok sistem. Kalau ada selisih, penyesuaian dibuat lewat
            form Stock In/Out yang sama dari daftar di bawah.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="aso-item">Barang *</Label>
              <select id="aso-item" required className={selectCls} value={f.item_id} onChange={(e) => setF((p) => ({ ...p, item_id: e.target.value }))}>
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
                <Label htmlFor="aso-qty">Stok Fisik (hasil hitung) *</Label>
                <Input id="aso-qty" type="number" required min="0" step="any" value={f.counted_qty} onChange={(e) => setF((p) => ({ ...p, counted_qty: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="aso-date">Tanggal *</Label>
                <Input id="aso-date" type="date" required value={f.opname_date} onChange={(e) => setF((p) => ({ ...p, opname_date: e.target.value }))} />
              </div>
            </div>
            {f.item_id && (
              <p className="text-muted-foreground text-sm">
                Stok sistem saat ini: <span className="font-medium text-foreground">{systemQty ?? "—"}</span>
                {variance != null && (
                  <>
                    {" "}— selisih:{" "}
                    <span className={`font-medium ${variance === 0 ? "text-foreground" : variance > 0 ? "text-success" : "text-destructive"}`}>
                      {variance > 0 ? `+${variance}` : variance}
                    </span>
                  </>
                )}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="aso-by">Dihitung oleh</Label>
                <Input id="aso-by" value={f.counted_by} onChange={(e) => setF((p) => ({ ...p, counted_by: e.target.value }))} placeholder="Nama penghitung" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="aso-cabang">Cabang</Label>
                <Input id="aso-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="aso-notes">Catatan</Label>
              <Textarea id="aso-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
