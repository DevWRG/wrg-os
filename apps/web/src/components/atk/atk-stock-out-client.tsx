"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddAtkStockMovementSheet } from "@/components/atk/add-atk-stock-movement-sheet";
import { AtkStockMovementTable, type AtkStockMovementRow, type AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";
import { AtkStockLevelTable, type AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";

// Halaman self-service utk tim DI LUAR General Affairs — form tambah dikunci
// ke Stock Out saja (mode="out"), riwayat read-only (tanpa edit/hapus; koreksi
// lewat GA di /atk-stock-in). Tab Cek Stok biar bisa liat ketersediaan dulu
// sebelum ambil. Lihat AddAtkStockMovementSheet utk alasan pemisahan menu ini.
export function AtkStockOutClient({
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
        <TabsTrigger value="movements">Riwayat Pengambilan ({movements.length})</TabsTrigger>
        <TabsTrigger value="levels">Cek Stok ({levels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="movements" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkStockMovementSheet mode="out" items={items} />
            </div>
            {movements.length === 0 ? (
              <EmptyState title="Belum ada pengambilan barang" description="Tambah lewat tombol Ambil Barang di atas." />
            ) : (
              <AtkStockMovementTable rows={movements} readOnly />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="levels" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            {levels.length === 0 ? (
              <EmptyState title="Belum ada barang" description="Barang ATK dikelola tim General Affairs." />
            ) : (
              <AtkStockLevelTable rows={levels} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
