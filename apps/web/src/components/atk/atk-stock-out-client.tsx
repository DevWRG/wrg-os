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

// Halaman self-service utk tim DI LUAR General Affairs — form tambah dikunci
// ke Stock Out saja (mode="out"), riwayat read-only (tanpa edit/hapus; koreksi
// lewat GA di /atk-stock-in). Tab Cek Stok biar bisa liat ketersediaan dulu
// sebelum ambil. Lihat AddAtkStockMovementSheet utk alasan pemisahan menu ini.
//
// Filter "Kategori Transaksi" (Barang/Materai, F49/F54 merge) — sama pola dgn
// AtkStockInClient, cuma filter di atas data yg sama.
export function AtkStockOutClient({
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
        <TabsTrigger value="movements">Riwayat Pengambilan ({filteredMovements.length})</TabsTrigger>
        <TabsTrigger value="levels">Cek Stok ({filteredLevels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="movements" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-between gap-2">
              {txCatFilter}
              <AddAtkStockMovementSheet mode="out" items={items} />
            </div>
            {filteredMovements.length === 0 ? (
              <EmptyState title="Belum ada pengambilan barang" description="Tambah lewat tombol Ambil Barang di atas." />
            ) : (
              <AtkStockMovementTable rows={filteredMovements} readOnly />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="levels" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">{txCatFilter}</div>
            {filteredLevels.length === 0 ? (
              <EmptyState title="Belum ada barang" description="Barang ATK dikelola tim General Affairs." />
            ) : (
              <AtkStockLevelTable rows={filteredLevels} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
