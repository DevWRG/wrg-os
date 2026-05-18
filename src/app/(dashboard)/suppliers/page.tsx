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

const suppliers = [
  {
    code: "SUP-001",
    name: "Mindray Medical Indonesia",
    country: "China / ID",
    category: "Patient Monitoring",
    pic: "Bpk. Andre",
    status: "Active",
  },
  {
    code: "SUP-002",
    name: "Philips Healthcare Indonesia",
    country: "Netherlands",
    category: "Multi-modality",
    pic: "Ibu Nadya",
    status: "Active",
  },
  {
    code: "SUP-003",
    name: "Omron Healthcare Indonesia",
    country: "Japan",
    category: "Home Diagnostic",
    pic: "Bpk. Heru",
    status: "Active",
  },
  {
    code: "SUP-004",
    name: "B. Braun Medical Indonesia",
    country: "Germany",
    category: "Infusion / Therapy",
    pic: "Ibu Sari",
    status: "Active",
  },
  {
    code: "SUP-005",
    name: "Dräger Indonesia",
    country: "Germany",
    category: "Anesthesia / OR",
    pic: "Bpk. Tomy",
    status: "On Review",
  },
  {
    code: "SUP-006",
    name: "GE Healthcare Indonesia",
    country: "USA",
    category: "Imaging",
    pic: "Ibu Putri",
    status: "Active",
  },
];

export default function SuppliersPage() {
  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Principal/manufacturer alat kesehatan yang didistribusikan."
        action={
          <Button>
            <Plus />
            New Supplier
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>PIC</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.code}>
                  <TableCell className="font-medium">{s.code}</TableCell>
                  <TableCell>{s.name}</TableCell>
                  <TableCell>{s.country}</TableCell>
                  <TableCell>{s.category}</TableCell>
                  <TableCell>{s.pic}</TableCell>
                  <TableCell>
                    <Badge
                      variant={s.status === "Active" ? "secondary" : "outline"}
                    >
                      {s.status}
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
