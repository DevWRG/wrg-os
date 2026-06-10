import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const inventory = [
  {
    sku: "ALK-MND-001",
    product: "Patient Monitor 5-parameter",
    warehouse: "Gudang Pusat - Cengkareng",
    onHand: 10,
    reserved: 4,
    available: 6,
    expiry: "—",
  },
  {
    sku: "ALK-MND-001",
    product: "Patient Monitor 5-parameter",
    warehouse: "Gudang Surabaya",
    onHand: 4,
    reserved: 0,
    available: 4,
    expiry: "—",
  },
  {
    sku: "ALK-OMR-074",
    product: "Tensimeter Digital HEM-7361T",
    warehouse: "Gudang Pusat - Cengkareng",
    onHand: 142,
    reserved: 18,
    available: 124,
    expiry: "—",
  },
  {
    sku: "ALK-CON-101",
    product: "Surgical Gloves Sterile (Box)",
    warehouse: "Gudang Pusat - Cengkareng",
    onHand: 540,
    reserved: 120,
    available: 420,
    expiry: "2027-03-15",
  },
  {
    sku: "ALK-CON-204",
    product: "Disposable Syringe 3cc (Box/100)",
    warehouse: "Gudang Bandung",
    onHand: 280,
    reserved: 50,
    available: 230,
    expiry: "2028-09-30",
  },
];

export default function InventoryPage() {
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Posisi stok per gudang, termasuk reservation dan masa kadaluwarsa."
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">On Hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead>Expiry</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inventory.map((i, idx) => (
                <TableRow key={`${i.sku}-${idx}`}>
                  <TableCell className="font-medium">{i.sku}</TableCell>
                  <TableCell>{i.product}</TableCell>
                  <TableCell>{i.warehouse}</TableCell>
                  <TableCell className="text-right">{i.onHand}</TableCell>
                  <TableCell className="text-right">{i.reserved}</TableCell>
                  <TableCell className="text-right font-medium">
                    {i.available}
                  </TableCell>
                  <TableCell>{i.expiry}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
