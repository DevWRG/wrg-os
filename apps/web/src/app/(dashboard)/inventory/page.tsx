"use client";

import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

const inventory = [
  { sku: "ALK-MND-001", product: "Patient Monitor 5-parameter", warehouse: "Gudang Pusat - Cengkareng", onHand: 10, reserved: 4, available: 6, expiry: "—" },
  { sku: "ALK-MND-001", product: "Patient Monitor 5-parameter", warehouse: "Gudang Surabaya", onHand: 4, reserved: 0, available: 4, expiry: "—" },
  { sku: "ALK-OMR-074", product: "Tensimeter Digital HEM-7361T", warehouse: "Gudang Pusat - Cengkareng", onHand: 142, reserved: 18, available: 124, expiry: "—" },
  { sku: "ALK-CON-101", product: "Surgical Gloves Sterile (Box)", warehouse: "Gudang Pusat - Cengkareng", onHand: 540, reserved: 120, available: 420, expiry: "2027-03-15" },
  { sku: "ALK-CON-204", product: "Disposable Syringe 3cc (Box/100)", warehouse: "Gudang Bandung", onHand: 280, reserved: 50, available: 230, expiry: "2028-09-30" },
];

type Inv = (typeof inventory)[number];
const columns: DataColumn<Inv>[] = [
  { id: "sku", header: "SKU", sortable: true, accessor: (i) => i.sku, cell: (i) => <span className="font-medium">{i.sku}</span> },
  { id: "product", header: "Product", sortable: true, accessor: (i) => i.product },
  { id: "warehouse", header: "Warehouse", sortable: true, accessor: (i) => i.warehouse },
  { id: "onHand", header: "On Hand", align: "right", sortable: true, accessor: (i) => i.onHand },
  { id: "reserved", header: "Reserved", align: "right", sortable: true, accessor: (i) => i.reserved },
  { id: "available", header: "Available", align: "right", sortable: true, accessor: (i) => i.available, cell: (i) => <span className="font-medium">{i.available}</span> },
  { id: "expiry", header: "Expiry", sortable: true, accessor: (i) => i.expiry },
];

export default function InventoryPage() {
  return (
    <>
      <PageHeader title="Inventory" description="Posisi stok per gudang, termasuk reservation dan masa kadaluwarsa." />
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={inventory} getKey={(i, idx) => `${i.sku}-${idx}`} searchPlaceholder="Cari SKU / produk / gudang…" pageSize={25} />
        </CardContent>
      </Card>
    </>
  );
}
