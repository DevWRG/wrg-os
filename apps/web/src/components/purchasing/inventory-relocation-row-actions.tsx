"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
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
import type { InventoryRelocationRow, InventoryRelocationStatus } from "@/components/purchasing/inventory-relocation-table";

// Native <select> (bukan komponen ui/select.tsx) — cukup utk 1 field enum
// pendek di dalam form Sheet, pola sama dgn form ATK (native <select> dgn
// kelas mengikuti tampilan Input).
const selectCls =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary-soft md:text-sm dark:bg-input/30";

const STATUS_OPTIONS: { value: InventoryRelocationStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

export function InventoryRelocationRowActions({ row }: { row: InventoryRelocationRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    item_desc: row.item_desc,
    qty: String(row.qty),
    unit: row.unit ?? "",
    cabang_asal: row.cabang_asal,
    cabang_tujuan: row.cabang_tujuan,
    reason: row.reason ?? "",
    requested_by: row.requested_by ?? "",
    request_date: row.request_date,
    status: row.status,
    notes: row.notes ?? "",
  });

  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const qty = Number(f.qty);
      if (!(qty > 0)) throw new Error("qty harus lebih dari 0");
      if (f.cabang_asal.trim() === f.cabang_tujuan.trim()) {
        throw new Error("cabang asal dan tujuan tidak boleh sama");
      }
      const res = await fetch(`/api/inventory-relocations/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_desc: f.item_desc.trim(),
          qty,
          unit: f.unit.trim() || null,
          cabang_asal: f.cabang_asal.trim(),
          cabang_tujuan: f.cabang_tujuan.trim(),
          reason: f.reason.trim() || null,
          requested_by: f.requested_by.trim() || null,
          request_date: f.request_date,
          status: f.status,
          notes: f.notes.trim() || null,
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

  function del() {
    confirm(
      { title: "Hapus request?", description: `Request relokasi "${row.item_desc}" (${row.cabang_asal} → ${row.cabang_tujuan}) akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/inventory-relocations/${row.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Request Relokasi</SheetTitle>
            <SheetDescription>{row.item_desc} — {row.cabang_asal} → {row.cabang_tujuan}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`irre-item-${row.id}`}>Barang *</Label>
                <Input id={`irre-item-${row.id}`} required value={f.item_desc} onChange={(e) => setF((p) => ({ ...p, item_desc: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-qty-${row.id}`}>Qty *</Label>
                  <Input id={`irre-qty-${row.id}`} type="number" min="0.01" step="0.01" required value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-unit-${row.id}`}>Satuan</Label>
                  <Input id={`irre-unit-${row.id}`} value={f.unit} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-asal-${row.id}`}>Cabang Asal *</Label>
                  <Input id={`irre-asal-${row.id}`} required value={f.cabang_asal} onChange={(e) => setF((p) => ({ ...p, cabang_asal: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-tujuan-${row.id}`}>Cabang Tujuan *</Label>
                  <Input id={`irre-tujuan-${row.id}`} required value={f.cabang_tujuan} onChange={(e) => setF((p) => ({ ...p, cabang_tujuan: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-date-${row.id}`}>Tgl Request</Label>
                  <Input id={`irre-date-${row.id}`} type="date" value={f.request_date} onChange={(e) => setF((p) => ({ ...p, request_date: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`irre-status-${row.id}`}>Status</Label>
                  <select
                    id={`irre-status-${row.id}`}
                    className={selectCls}
                    value={f.status}
                    onChange={(e) => setF((p) => ({ ...p, status: e.target.value as InventoryRelocationStatus }))}
                  >
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`irre-requested-by-${row.id}`}>Diminta oleh</Label>
                <Input id={`irre-requested-by-${row.id}`} value={f.requested_by} onChange={(e) => setF((p) => ({ ...p, requested_by: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`irre-reason-${row.id}`}>Alasan</Label>
                <Input id={`irre-reason-${row.id}`} value={f.reason} onChange={(e) => setF((p) => ({ ...p, reason: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`irre-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`irre-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
