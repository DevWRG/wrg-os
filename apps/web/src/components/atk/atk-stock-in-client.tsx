"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddAtkStockMovementSheet } from "@/components/atk/add-atk-stock-movement-sheet";
import { AtkStockMovementTable, type AtkStockMovementRow, type AtkStockItemOption, type AtkTransactionCategory } from "@/components/atk/atk-stock-movement-table";
import { AtkStockLevelTable, type AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

type TxCatFilter = "all" | AtkTransactionCategory;

// Halaman GA (tim General Affairs) — audit penuh semua mutasi (in & out, incl.
// yg dicatat tim lain lewat /atk-stock-out), tapi form tambah dikunci ke Stock
// In saja (mode="in"). Edit/hapus tetap tersedia (GA yg membetulkan salah catat
// dari tim mana pun). Lihat AddAtkStockMovementSheet utk alasan pemisahan.
//
// Filter "Kategori Transaksi" (Barang/Materai, F49/F54 merge) — Materai (F54)
// bukan tab/halaman terpisah, cuma filter di atas data yg sama; workflow
// Stock In/Out & komponen di bawahnya tidak berubah sama sekali.
export function AtkStockInClient({
  movements,
  levels,
  items,
}: {
  movements: AtkStockMovementRow[];
  levels: AtkStockLevelRow[];
  items: AtkStockItemOption[];
}) {
  const [txCat, setTxCat] = useState<TxCatFilter>("all");
  const filteredMovements = txCat === "all" ? movements : movements.filter((m) => m.item_transaction_category === txCat);
  const filteredLevels = txCat === "all" ? levels : levels.filter((l) => l.transaction_category === txCat);

  const txCatFilter = (
    <Select value={txCat} onValueChange={(v) => setTxCat(v as TxCatFilter)}>
      <SelectTrigger size="sm" className="w-[160px]" aria-label="Kategori Transaksi">
        <SelectValue>{(v) => (v === "barang" ? "Barang" : v === "materai" ? "Materai" : "Semua Kategori")}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Semua Kategori</SelectItem>
        <SelectItem value="barang">Barang</SelectItem>
        <SelectItem value="materai">Materai</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <Tabs defaultValue="movements">
      <TabsList>
        <TabsTrigger value="movements">Mutasi Stok ({filteredMovements.length})</TabsTrigger>
        <TabsTrigger value="levels">Stok Saat Ini ({filteredLevels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="movements" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-between gap-2">
              {txCatFilter}
              <AddAtkStockMovementSheet mode="in" items={items} />
            </div>
            {filteredMovements.length === 0 ? (
              <EmptyState title="Belum ada mutasi stok" description="Tambah lewat tombol Catat Stok Masuk di atas." />
            ) : (
              <AtkStockMovementTable rows={filteredMovements} items={items} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="levels" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">{txCatFilter}</div>
            {filteredLevels.length === 0 ? (
              <EmptyState title="Belum ada barang" description="Tambah barang ATK dulu di halaman ATK Master." />
            ) : (
              <AtkStockLevelTable rows={filteredLevels} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
