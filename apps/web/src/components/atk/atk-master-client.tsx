"use client";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddAtkCategorySheet } from "@/components/atk/add-atk-category-sheet";
import { AtkCategoryTable, type AtkCategoryRow } from "@/components/atk/atk-category-table";
import { AddAtkSupplierSheet } from "@/components/atk/add-atk-supplier-sheet";
import { AtkSupplierTable, type AtkSupplierRow } from "@/components/atk/atk-supplier-table";
import { AddAtkItemSheet } from "@/components/atk/add-atk-item-sheet";
import { AtkItemTable, type AtkItemRow, type AtkItemOption } from "@/components/atk/atk-item-table";

export function AtkMasterClient({
  categories,
  suppliers,
  items,
}: {
  categories: AtkCategoryRow[];
  suppliers: AtkSupplierRow[];
  items: AtkItemRow[];
}) {
  const categoryOptions: AtkItemOption[] = categories.map((c) => ({ id: c.id, name: c.name }));
  const supplierOptions: AtkItemOption[] = suppliers.map((s) => ({ id: s.id, name: s.name }));

  return (
    <Tabs defaultValue="items">
      <TabsList>
        <TabsTrigger value="items">Items ({items.length})</TabsTrigger>
        <TabsTrigger value="categories">Categories ({categories.length})</TabsTrigger>
        <TabsTrigger value="suppliers">Suppliers ({suppliers.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="items" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkItemSheet categories={categoryOptions} suppliers={supplierOptions} />
            </div>
            {items.length === 0 ? (
              <EmptyState title="Belum ada barang" description="Tambah lewat tombol Tambah Barang di atas." />
            ) : (
              <AtkItemTable rows={items} categories={categoryOptions} suppliers={supplierOptions} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="categories" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkCategorySheet />
            </div>
            {categories.length === 0 ? (
              <EmptyState title="Belum ada kategori" description="Tambah lewat tombol Tambah Kategori di atas." />
            ) : (
              <AtkCategoryTable rows={categories} />
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="suppliers" className="mt-4">
        <Card>
          <CardContent className="flex flex-col gap-4 pt-6">
            <div className="flex justify-end">
              <AddAtkSupplierSheet />
            </div>
            {suppliers.length === 0 ? (
              <EmptyState title="Belum ada pemasok" description="Tambah lewat tombol Tambah Pemasok di atas." />
            ) : (
              <AtkSupplierTable rows={suppliers} />
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
