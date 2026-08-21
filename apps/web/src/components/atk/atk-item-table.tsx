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

export interface AtkItemOption {
  id: string;
  name: string;
}

export interface AtkItemRow {
  id: string;
  name: string;
  unit: string;
  category_id: string | null;
  category_name: string | null;
  default_supplier_id: string | null;
  default_supplier_name: string | null;
  min_stock: number | null;
  notes: string | null;
  is_active: boolean;
}

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

function ItemRowActions({
  row,
  categories,
  suppliers,
}: {
  row: AtkItemRow;
  categories: AtkItemOption[];
  suppliers: AtkItemOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    name: row.name,
    unit: row.unit,
    category_id: row.category_id ?? "",
    default_supplier_id: row.default_supplier_id ?? "",
    min_stock: row.min_stock != null ? String(row.min_stock) : "",
    notes: row.notes ?? "",
  });
  const { confirm, dialog } = useConfirm();

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/atk/items/${row.id}`, {
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
        name: f.name.trim(),
        unit: f.unit.trim(),
        category_id: f.category_id || null,
        default_supplier_id: f.default_supplier_id || null,
        min_stock: f.min_stock.trim() ? Number(f.min_stock) : null,
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

  async function toggleActive() {
    setBusy(true);
    try {
      await patch({ is_active: !row.is_active });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function del() {
    confirm({ title: "Hapus barang?", description: `"${row.name}" akan dihapus dari katalog ATK.`, destructive: true, confirmLabel: "Hapus" }, async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/atk/items/${row.id}`, { method: "DELETE" });
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
      <Button variant="ghost" size="sm" disabled={busy} onClick={toggleActive}>
        {row.is_active ? "Nonaktifkan" : "Aktifkan"}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit Barang ATK</SheetTitle>
            <SheetDescription>{row.name}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`ai-e-name-${row.id}`}>Nama *</Label>
                <Input id={`ai-e-name-${row.id}`} required value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor={`ai-e-unit-${row.id}`}>Satuan *</Label>
                  <Input id={`ai-e-unit-${row.id}`} required value={f.unit} onChange={(e) => setF((p) => ({ ...p, unit: e.target.value }))} placeholder="pcs/box/rim" />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={`ai-e-minstock-${row.id}`}>Min. Stok</Label>
                  <Input id={`ai-e-minstock-${row.id}`} type="number" min="0" step="any" value={f.min_stock} onChange={(e) => setF((p) => ({ ...p, min_stock: e.target.value }))} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ai-e-cat-${row.id}`}>Kategori</Label>
                <select id={`ai-e-cat-${row.id}`} className={selectCls} value={f.category_id} onChange={(e) => setF((p) => ({ ...p, category_id: e.target.value }))}>
                  <option value="">— Tanpa kategori —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ai-e-sup-${row.id}`}>Pemasok Default</Label>
                <select id={`ai-e-sup-${row.id}`} className={selectCls} value={f.default_supplier_id} onChange={(e) => setF((p) => ({ ...p, default_supplier_id: e.target.value }))}>
                  <option value="">— Tanpa pemasok default —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`ai-e-notes-${row.id}`}>Catatan</Label>
                <Textarea id={`ai-e-notes-${row.id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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

export function AtkItemTable({
  rows,
  categories,
  suppliers,
}: {
  rows: AtkItemRow[];
  categories: AtkItemOption[];
  suppliers: AtkItemOption[];
}) {
  const columns: DataColumn<AtkItemRow>[] = [
    { id: "name", header: "Nama", sortable: true, accessor: (r) => r.name, cell: (r) => <span className="font-medium">{r.name}</span> },
    { id: "unit", header: "Satuan", sortable: true, accessor: (r) => r.unit, cell: (r) => r.unit },
    { id: "cat", header: "Kategori", sortable: true, accessor: (r) => r.category_name ?? "", cell: (r) => r.category_name ?? "—" },
    { id: "sup", header: "Pemasok Default", sortable: true, accessor: (r) => r.default_supplier_name ?? "", cell: (r) => r.default_supplier_name ?? "—" },
    { id: "minstock", header: "Min. Stok", align: "right", sortable: true, accessor: (r) => r.min_stock ?? 0, cell: (r) => (r.min_stock != null ? r.min_stock : "—") },
    { id: "status", header: "Status", cell: (r) => (r.is_active ? <Badge className="bg-success/10 text-success">Aktif</Badge> : <Badge variant="secondary">Nonaktif</Badge>) },
    { id: "aksi", header: "Aksi", align: "right", cell: (r) => <ItemRowActions row={r} categories={categories} suppliers={suppliers} /> },
  ];
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari barang…" pageSize={25} />;
}
