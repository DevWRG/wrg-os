import { MoreHorizontal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const rows = [
  { id: "PO-001", customer: "RS Premier Bintaro", total: "Rp 12.4M", status: "Processing" },
  { id: "PO-002", customer: "Klinik Kimia Farma", total: "Rp 2.8M", status: "Shipped" },
  { id: "PO-003", customer: "RSUD Tangerang", total: "Rp 41.2M", status: "Awaiting Payment" },
  { id: "PO-004", customer: "Apotek Century", total: "Rp 0.8M", status: "Delivered" },
];

export default function TablesShowcasePage() {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Basic</CardTitle>
          <CardDescription>Tabel polos, header sticky-able.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.id}</TableCell>
                  <TableCell>{r.customer}</TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell>{r.status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>With Badge + Action Menu</CardTitle>
          <CardDescription>
            Status pakai Badge, kolom action pakai DropdownMenu.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.id}</TableCell>
                  <TableCell>{r.customer}</TableCell>
                  <TableCell className="text-right">{r.total}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        r.status === "Delivered"
                          ? "secondary"
                          : r.status === "Awaiting Payment"
                            ? "outline"
                            : "default"
                      }
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Row actions"
                          />
                        }
                      >
                        <MoreHorizontal />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>View detail</DropdownMenuItem>
                        <DropdownMenuItem>Edit</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive">
                          Cancel order
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Striped Rows</CardTitle>
          <CardDescription>Zebra rows lebih enak buat list panjang.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                { sku: "ALK-MND-001", name: "Patient Monitor 5-parameter", stock: 14 },
                { sku: "ALK-PHL-218", name: "Defibrillator AED HeartStart", stock: 6 },
                { sku: "ALK-OMR-074", name: "Tensimeter Digital", stock: 142 },
                { sku: "ALK-BBR-512", name: "Infusion Pump Space", stock: 0 },
              ].map((r, i) => (
                <TableRow key={r.sku} className={i % 2 === 1 ? "bg-muted/40" : ""}>
                  <TableCell className="font-medium">{r.sku}</TableCell>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="text-right">{r.stock}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
