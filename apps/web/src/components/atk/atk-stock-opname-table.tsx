"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataColumn } from "@/components/ui/data-table";
import { useConfirm } from "@/components/ui/use-confirm";
import { AddAtkStockMovementSheet } from "@/components/atk/add-atk-stock-movement-sheet";
import type { AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";

export type AtkTransactionCategory = "barang" | "materai";

export interface AtkStockOpnameRow {
  id: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  item_transaction_category: AtkTransactionCategory;
  opname_date: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  counted_by: string | null;
  cabang: string | null;
  notes: string | null;
  adjustment_movement_id: string | null;
}

// Aksi "Buat Penyesuaian" MEMAKAI ULANG AddAtkStockMovementSheet (form yang
// sama dgn Stock In/Out) — F136 sengaja tidak bikin form movement baru, cuma
// beda tombol pemicu + prefill dari hasil opname (qty = |variance|, mode
// otomatis dari arah selisih). Setelah movement tersimpan, opname di-PATCH
// biar tercatat "sudah disesuaikan" (adjustment_movement_id).
function OpnameRowActions({ row, items }: { row: AtkStockOpnameRow; items: AtkStockItemOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  async function linkAdjustment(movementId: string) {
    try {
      await fetch(`/api/atk/stock-opname/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adjustment_movement_id: movementId }),
      });
    } finally {
      router.refresh();
    }
  }

  function del() {
    confirm(
      { title: "Hapus catatan opname?", description: `Hasil opname "${row.item_name}" (${row.opname_date}) akan dihapus. Mutasi penyesuaian yg sudah dibuat tidak ikut terhapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/atk/stock-opname/${row.id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      }
    );
  }

  const needsAdjustment = row.variance !== 0 && !row.adjustment_movement_id;

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      {needsAdjustment && (
        <AddAtkStockMovementSheet
          mode={row.variance > 0 ? "in" : "out"}
          items={items}
          trigger={<span>Buat Penyesuaian</span>}
          initial={{
            item_id: row.item_id,
            qty: String(Math.abs(row.variance)),
            reference: `Opname ${row.opname_date}`,
            notes: `Penyesuaian hasil stock opname (stok sistem ${row.system_qty} → fisik ${row.counted_qty}).`,
          }}
          onSaved={linkAdjustment}
        />
      )}
      <Button variant="ghost" size="icon-sm" aria-label="Hapus" disabled={busy} onClick={del} className="text-danger hover:text-danger">
        <Trash2 />
      </Button>
    </div>
  );
}

export function AtkStockOpnameTable({ rows, items }: { rows: AtkStockOpnameRow[]; items: AtkStockItemOption[] }) {
  const columns: DataColumn<AtkStockOpnameRow>[] = [
    { id: "date", header: "Tanggal", sortable: true, accessor: (r) => r.opname_date, cell: (r) => r.opname_date },
    { id: "item", header: "Barang", sortable: true, accessor: (r) => r.item_name, cell: (r) => <span className="font-medium">{r.item_name}</span> },
    {
      id: "txcat",
      header: "Kategori Transaksi",
      sortable: true,
      accessor: (r) => r.item_transaction_category,
      cell: (r) =>
        r.item_transaction_category === "materai" ? (
          <Badge className="bg-info-soft text-info">Materai</Badge>
        ) : (
          <Badge variant="secondary">Barang</Badge>
        ),
    },
    { id: "system", header: "Stok Sistem", align: "right", sortable: true, accessor: (r) => r.system_qty, cell: (r) => `${r.system_qty} ${r.item_unit}` },
    { id: "counted", header: "Stok Fisik", align: "right", sortable: true, accessor: (r) => r.counted_qty, cell: (r) => `${r.counted_qty} ${r.item_unit}` },
    {
      id: "variance",
      header: "Selisih",
      align: "right",
      sortable: true,
      accessor: (r) => r.variance,
      cell: (r) =>
        r.variance === 0 ? (
          <Badge variant="secondary">Sesuai</Badge>
        ) : r.variance > 0 ? (
          <Badge className="bg-success/10 text-success">Surplus +{r.variance}</Badge>
        ) : (
          <Badge variant="destructive">Kurang {r.variance}</Badge>
        ),
    },
    {
      id: "status",
      header: "Penyesuaian",
      cell: (r) =>
        r.variance === 0 ? (
          "—"
        ) : r.adjustment_movement_id ? (
          <Badge className="bg-success/10 text-success">Sudah disesuaikan</Badge>
        ) : (
          <Badge variant="destructive">Perlu penyesuaian</Badge>
        ),
    },
    { id: "by", header: "Dihitung oleh", sortable: true, accessor: (r) => r.counted_by ?? "", cell: (r) => r.counted_by ?? "—" },
    { id: "cabang", header: "Cabang", sortable: true, accessor: (r) => r.cabang ?? "", cell: (r) => r.cabang ?? "—" },
    { id: "aksi", header: "Aksi", align: "right" as const, cell: (r) => <OpnameRowActions row={r} items={items} /> },
  ];
  return <DataTable columns={columns} data={rows} getKey={(r) => r.id} searchPlaceholder="Cari opname…" pageSize={25} />;
}
