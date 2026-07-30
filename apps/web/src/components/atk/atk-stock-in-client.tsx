"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddAtkStockMovementSheet } from "@/components/atk/add-atk-stock-movement-sheet";
import { AtkStockMovementTable, type AtkStockMovementRow, type AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
import { AtkStockLevelTable, type AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

// Halaman GA (tim General Affairs) — audit penuh semua mutasi (in & out, incl.
// yg dicatat tim lain lewat /atk-stock-out), tapi form tambah dikunci ke Stock
// In saja (mode="in"). Edit/hapus tetap tersedia (GA yg membetulkan salah catat
// dari tim mana pun). Lihat AddAtkStockMovementSheet utk alasan pemisahan.
export function AtkStockInClient({
  movements,
  levels,
  items,
}: {
  movements: AtkStockMovementRow[];
  levels: AtkStockLevelRow[];
  items: AtkStockItemOption[];
}) {
  return (
    <Tabs defaultValue="movements">
      <TabsList>
        <TabsTrigger value="movements">Mutasi Stok ({movements.length})</TabsTrigger>
        <TabsTrigger value="levels">Stok Saat Ini ({levels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="movements" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkStockMovementSheet mode="in" items={items} />
            </div>
            {movements.length === 0 ? (
              <EmptyState title="Belum ada mutasi stok" description="Tambah lewat tombol Catat Stok Masuk di atas." />
            ) : (
              <AtkStockMovementTable rows={movements} items={items} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="levels" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {levels.length === 0 ? (
              <EmptyState title="Belum ada barang" description="Tambah barang ATK dulu di halaman ATK Master." />
            ) : (
              <AtkStockLevelTable rows={levels} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
