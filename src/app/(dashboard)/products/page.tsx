import { Plus } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const products = [
  {
    sku: "ALK-MND-001",
    name: "Patient Monitor 5-parameter",
    brand: "Mindray",
    category: "Monitoring",
    stock: 14,
    status: "In Stock",
  },
  {
    sku: "ALK-PHL-218",
    name: "Defibrillator AED HeartStart",
    brand: "Philips",
    category: "Emergency",
    stock: 6,
    status: "Low Stock",
  },
  {
    sku: "ALK-OMR-074",
    name: "Tensimeter Digital HEM-7361T",
    brand: "Omron",
    category: "Diagnostic",
    stock: 142,
    status: "In Stock",
  },
  {
    sku: "ALK-BBR-512",
    name: "Infusion Pump Space",
    brand: "B. Braun",
    category: "Therapy",
    stock: 0,
    status: "Out of Stock",
  },
  {
    sku: "ALK-DRG-091",
    name: "Anesthesia Machine Fabius",
    brand: "Dräger",
    category: "OR Equipment",
    stock: 3,
    status: "Low Stock",
  },
  {
    sku: "ALK-GE-308",
    name: "USG Voluson E10",
    brand: "GE Healthcare",
    category: "Imaging",
    stock: 2,
    status: "Low Stock",
  },
];

const statusTone: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  "In Stock": "secondary",
  "Low Stock": "outline",
  "Out of Stock": "destructive",
};

export default function ProductsPage() {
  return (
    <>
      <PageHeader
        title="Products"
        description="Katalog SKU alat kesehatan beserta status stok terkini."
        action={
          <Button>
            <Plus />
            New Product
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Stock</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.sku}>
                  <TableCell className="font-medium">{p.sku}</TableCell>
                  <TableCell>{p.name}</TableCell>
                  <TableCell>{p.brand}</TableCell>
                  <TableCell>{p.category}</TableCell>
                  <TableCell className="text-right">{p.stock}</TableCell>
                  <TableCell>
                    <Badge variant={statusTone[p.status] ?? "outline"}>
                      {p.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
