"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
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

export interface AtkStockItemOption {
  id: string;
  name: string;
  unit: string;
  is_active: boolean;
}

export interface AtkStockMovementRow {
  id: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  movement_type: "in" | "out";
  qty: number;
  movement_date: string;
  reference: string | null;
  pic: string | null;
  cabang: string | null;
  notes: string | null;
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function MovementRowActions({ row, items }: { row: AtkStockMovementRow; items: AtkStockItemOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    item_id: row.item_id,
    movement_type: row.movement_type,
    qty: String(row.qty),
    movement_date: row.movement_date,
    reference: row.reference ?? "",
    pic: row.pic ?? "",
    cabang: row.cabang ?? "",
    notes: row.notes ?? "",
  });
  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/atk/stock-movements/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          item_id: f.item_id,
          movement_type: f.movement_type,
          qty: Number(f.qty),
          movement_date: f.movement_date,
          reference: f.reference.trim() || null,
          pic: f.pic.trim() || null,
          cabang: f.cabang.trim() || null,
          notes: f.notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "gagal menyimpan");
      }
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
      { title: "Hapus mutasi stok?", description: `Mutasi ${row.movement_type === "in" ? "masuk" : "keluar"} "${row.item_name}" (${row.qty} ${row.item_unit}) akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/atk/stock-movements/${row.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      }
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
            <SheetTitle>Edit Mutasi Stok</SheetTitle>
            <SheetDescription>{row.item_name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`asm-e-type-${row.id}`}>Tipe *</Label>
                <select
                  id={`asm-e-type-${row.id}`}
                  className={selectCls}
                  value={f.movement_type}
                  onChange={(e) => setF((p) => ({ ...p, movement_type: e.target.value as "in" | "out" }))}
                >
                  <option value="in">Masuk</option>
                  <option value="out">Keluar</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`asm-e-item-${row.id}`}>Barang *</Label>
                <select id={`asm-e-item-${row.id}`} className={selectCls} value={f.item_id} onChange={(e) => setF((p) => ({ ...p, item_id: e.target.value }))}>
                  {items.map((i) => (
                    <option key={i.id} value={i.id} disabled={!i.is_active && i.id !== row.item_id}>
                      {i.name} ({i.unit}){i.is_active ? "" : " — nonaktif"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`asm-e-qty-${row.id}`}>Qty *</Label>
                  <Input id={`asm-e-qty-${row.id}`} type="number" required min="0" step="any" value={f.qty} onChange={(e) => setF((p) => ({ ...p, qty: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`asm-e-date-${row.id}`}>Tanggal *</Label>
                  <Input id={`asm-e-date-${row.id}`} type="date" required value={f.movement_date} onChange={(e) => setF((p) => ({ ...p, movement_date: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`asm-e-ref-${row.id}`}>Referensi</Label>
                <Input id={`asm-e-ref-${row.id}`} value={f.reference} onChange={(e) => setF((p) => ({ ...p, reference: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`asm-e-pic-${row.id}`}>PIC</Label>
                  <Input id={`asm-e-pic-${row.id}`} value={f.pic} onChange={(e) => setF((p) => ({ ...p, pic: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`asm-e-cabang-${row.id}`}>Cabang</Label>
                  <Input id={`asm-e-cabang-${row.id}`} value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`asm-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`asm-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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

export function AtkStockMovementTable({
  rows,
  items,
  readOnly = false,
}: {
  rows: AtkStockMovementRow[];
  items?: AtkStockItemOption[];
  readOnly?: boolean;
}) {
  const columns: DataColumn<AtkStockMovementRow>[] = [
    { id: "date", header: "Tanggal", sortable: true, accessor: (r) => r.movement_date, cell: (r) => r.movement_date },
    { id: "item", header: "Barang", sortable: true, accessor: (r) => r.item_name, cell: (r) => <span className="font-medium">{r.item_name}</span> },
    {
      id: "type",
      header: "Tipe",
      sortable: true,
      accessor: (r) => r.movement_type,
      cell: (r) => (r.movement_type === "in" ? <Badge className="bg-success/10 text-success">Masuk</Badge> : <Badge variant="destructive">Keluar</Badge>),
    },
    { id: "qty", header: "Qty", align: "right", sortable: true, accessor: (r) => r.qty, cell: (r) => `${r.qty} ${r.item_unit}` },
    { id: "ref", header: "Referensi", sortable: true, accessor: (r) => r.reference ?? "", cell: (r) => r.reference ?? "—" },
    { id: "pic", header: "PIC", sortable: true, accessor: (r) => r.pic ?? "", cell: (r) => r.pic ?? "—" },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => r.cabang ?? "—" },
    ...(readOnly ? [] : [{ id: "aksi", header: "Aksi", align: "right" as const, cell: (r: AtkStockMovementRow) => <MovementRowActions row={r} items={items ?? []} /> }]),
  ];
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari mutasi…" pageSize={25} />;
}
