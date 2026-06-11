"use client";

import { Plus } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DataTable, type DataColumn } from "@/components/ui/data-table";

const products = [
  { sku: "ALK-MND-001", name: "Patient Monitor 5-parameter", brand: "Mindray", category: "Monitoring", stock: 14, status: "In Stock" },
  { sku: "ALK-PHL-218", name: "Defibrillator AED HeartStart", brand: "Philips", category: "Emergency", stock: 6, status: "Low Stock" },
  { sku: "ALK-OMR-074", name: "Tensimeter Digital HEM-7361T", brand: "Omron", category: "Diagnostic", stock: 142, status: "In Stock" },
  { sku: "ALK-BBR-512", name: "Infusion Pump Space", brand: "B. Braun", category: "Therapy", stock: 0, status: "Out of Stock" },
  { sku: "ALK-DRG-091", name: "Anesthesia Machine Fabius", brand: "Dräger", category: "OR Equipment", stock: 3, status: "Low Stock" },
  { sku: "ALK-GE-308", name: "USG Voluson E10", brand: "GE Healthcare", category: "Imaging", stock: 2, status: "Low Stock" },
];

const statusTone: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  "In Stock": "secondary",
  "Low Stock": "outline",
  "Out of Stock": "destructive",
};

type Product = (typeof products)[number];
const columns: DataColumn<Product>[] = [
  { id: "sku", header: "SKU", sortable: true, accessor: (p) => p.sku, cell: (p) => <span className="font-medium">{p.sku}</span> },
  { id: "name", header: "Name", sortable: true, accessor: (p) => p.name },
  { id: "brand", header: "Brand", sortable: true, accessor: (p) => p.brand },
  { id: "category", header: "Category", sortable: true, accessor: (p) => p.category },
  { id: "stock", header: "Stock", align: "right", sortable: true, accessor: (p) => p.stock },
  { id: "status", header: "Status", sortable: true, accessor: (p) => p.status, cell: (p) => <Badge variant={statusTone[p.status] ?? "outline"}>{p.status}</Badge> },
];

export default function ProductsPage() {
  return (
    <>
      <PageHeader title="Products" description="Katalog SKU alat kesehatan beserta status stok terkini." action={<Button><Plus />New Product</Button>} />
      <Card>
        <CardContent className="pt-6">
          <DataTable columns={columns} data={products} getKey={(p) => p.sku} searchPlaceholder="Cari SKU / nama / brand…" pageSize={25} />
        </CardContent>
      </Card>
    </>
  );
}
