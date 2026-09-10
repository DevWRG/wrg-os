"use client";

import { useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddAtkStockOpnameSheet } from "@/components/atk/add-atk-stock-opname-sheet";
import { AtkStockOpnameTable, type AtkStockOpnameRow } from "@/components/atk/atk-stock-opname-table";
import { AtkStockLevelTable, type AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";
import type { AtkStockItemOption, AtkTransactionCategory } from "@/components/atk/atk-stock-movement-table";

type TxCatFilter = "all" | AtkTransactionCategory;

// F136 — hitung fisik ATK vs stok sistem (F49). Penyesuaian selisih dibuat
// lewat form Stock In/Out yang sama (lihat AtkStockOpnameTable), bukan form
// baru; halaman ini cuma submenu tambahan di grup General Affairs.
//
// Filter "Kategori Transaksi" (Barang/Materai, F49/F54 merge) — sama pola dgn
// AtkStockInClient/AtkStockOutClient.
export function AtkStockOpnameClient({
  opnames,
  levels,
  items,
}: {
  opnames: AtkStockOpnameRow[];
  levels: AtkStockLevelRow[];
  items: AtkStockItemOption[];
}) {
  const [txCat, setTxCat] = useState<TxCatFilter>("all");
  const filteredOpnames = txCat === "all" ? opnames : opnames.filter((o) => o.item_transaction_category === txCat);
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
    <Tabs defaultValue="opname">
      <TabsList>
        <TabsTrigger value="opname">Riwayat Opname ({filteredOpnames.length})</TabsTrigger>
        <TabsTrigger value="levels">Stok Sistem ({filteredLevels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="opname" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-between gap-2">
              {txCatFilter}
              <AddAtkStockOpnameSheet items={items} levels={levels} />
            </div>
            {filteredOpnames.length === 0 ? (
              <EmptyState title="Belum ada opname" description="Tambah lewat tombol Catat Opname di atas." />
            ) : (
              <AtkStockOpnameTable rows={filteredOpnames} items={items} />
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
