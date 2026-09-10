"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Trash2 } from "lucide-react";

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
import type { SupplierEtaRow } from "@/components/tables/supplier-eta-table";

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function SupplierEtaRowActions({ row }: { row: SupplierEtaRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    vendor_name: row.vendor_name,
    po_number: row.po_number ?? "",
    item_desc: row.item_desc,
    qty: row.qty != null ? String(row.qty) : "",
    eta_date: row.eta_date.slice(0, 10),
    status: row.status,
    cabang: row.cabang ?? "",
    notes: row.notes ?? "",
  });

  const { confirm, dialog } = useConfirm();

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/supplier-eta/${row.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "gagal menyimpan");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await patch({
        vendor_name: f.vendor_name.trim(),
        po_number: f.po_number.trim() || null,
        item_desc: f.item_desc.trim(),
        qty: f.qty.trim() ? Number(f.qty) : null,
        eta_date: f.eta_date,
        status: f.status,
        cabang: f.cabang.trim() || null,
        notes: f.notes.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  async function markArrived() {
    setBusy(true);
    try {
      await patch({ status: "arrived" });
      router.refresh();
    } catch {
      // biarkan tabel tetap seperti semula; error jarang terjadi di aksi cepat ini
    } finally {
      setBusy(false);
    }
  }

  function del() {
    confirm({ title: "Hapus catatan ETA?", description: `"${row.item_desc}" dari ${row.vendor_name} akan dihapus.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/supplier-eta/${row.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error("gagal hapus");
        router.refresh();
      } catch {
        setBusy(false);
      }
    });
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      {row.status === "pending" && (
        <Button variant="ghost" size="icon-sm" aria-label="Tandai datang" disabled={busy} onClick={markArrived} className="text-success hover:text-success">
          <CheckCircle2 />
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Supplier ETA</SheetTitle>
            <SheetDescription>{row.vendor_name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-vendor-${row.id}`}>Supplier *</Label>
                <Input id={`se-e-vendor-${row.id}`} required value={f.vendor_name} onChange={(e) => setF((p) => ({ ...p, vendor_name: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-po-${row.id}`}>No. PO / Referensi</Label>
                <Input id={`se-e-po-${row.id}`} value={f.po_number} onChange={(e) => setF((p) => ({ ...p, po_number: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-item-${row.id}`}>Barang *</Label>
                <Input id={`se-e-item-${row.id}`} required value={f.item_desc} onChange={(e) => setF((p) => ({ ...p, item_desc: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`se-e-qty-${row.id}`}>Qty</Label>
                  <Input id={`se-e-qty-${row.id}`} type="number" min="0" step="any" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`se-e-eta-${row.id}`}>ETA *</Label>
                  <Input id={`se-e-eta-${row.id}`} type="date" required value={f.eta_date} onChange={(e) => setF((p) => ({ ...p, eta_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-status-${row.id}`}>Status</Label>
                <select id={`se-e-status-${row.id}`} className={selectCls} value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value as SupplierEtaRow["status"] }))}>
                  <option value="pending">Pending</option>
                  <option value="arrived">Sudah datang</option>
                  <option value="cancelled">Dibatalkan</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-cabang-${row.id}`}>Cabang tujuan</Label>
                <Input id={`se-e-cabang-${row.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`se-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`se-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
