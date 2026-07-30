"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddAtkStockOpnameSheet } from "@/components/atk/add-atk-stock-opname-sheet";
import { AtkStockOpnameTable, type AtkStockOpnameRow } from "@/components/atk/atk-stock-opname-table";
import { AtkStockLevelTable, type AtkStockLevelRow } from "@/components/atk/atk-stock-level-table";
import type { AtkStockItemOption } from "@/components/atk/atk-stock-movement-table";

// F136 — hitung fisik ATK vs stok sistem (F135). Penyesuaian selisih dibuat
// lewat form Stock In/Out yang sama (lihat AtkStockOpnameTable), bukan form
// baru; halaman ini cuma submenu tambahan di grup General Affairs.
export function AtkStockOpnameClient({
  opnames,
  levels,
  items,
}: {
  opnames: AtkStockOpnameRow[];
  levels: AtkStockLevelRow[];
  items: AtkStockItemOption[];
}) {
  return (
    <Tabs defaultValue="opname">
      <TabsList>
        <TabsTrigger value="opname">Riwayat Opname ({opnames.length})</TabsTrigger>
        <TabsTrigger value="levels">Stok Sistem ({levels.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="opname" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkStockOpnameSheet items={items} levels={levels} />
            </div>
            {opnames.length === 0 ? (
              <EmptyState title="Belum ada opname" description="Tambah lewat tombol Catat Opname di atas." />
            ) : (
              <AtkStockOpnameTable rows={opnames} items={items} />
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
