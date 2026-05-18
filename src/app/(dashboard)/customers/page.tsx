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

const customers = [
  {
    code: "CUST-0142",
    name: "RS Premier Bintaro",
    type: "Rumah Sakit",
    city: "Tangerang Selatan",
    pic: "dr. Adi Nugroho",
    status: "Active",
  },
  {
    code: "CUST-0141",
    name: "RSUD Tangerang",
    type: "Rumah Sakit",
    city: "Tangerang",
    pic: "Bpk. Sutrisno",
    status: "Active",
  },
  {
    code: "CUST-0140",
    name: "Klinik Kimia Farma Sudirman",
    type: "Klinik",
    city: "Jakarta Pusat",
    pic: "Ibu Lestari",
    status: "Active",
  },
  {
    code: "CUST-0139",
    name: "Apotek Century Kelapa Gading",
    type: "Apotek",
    city: "Jakarta Utara",
    pic: "Bpk. Rahmat",
    status: "Active",
  },
  {
    code: "CUST-0138",
    name: "Puskesmas Pasar Minggu",
    type: "Puskesmas",
    city: "Jakarta Selatan",
    pic: "dr. Maria",
    status: "On Hold",
  },
  {
    code: "CUST-0137",
    name: "RS Hermina Bekasi",
    type: "Rumah Sakit",
    city: "Bekasi",
    pic: "Ibu Yuli",
    status: "Active",
  },
];

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Daftar rumah sakit, klinik, apotek, dan puskesmas yang dilayani."
        action={
          <Button>
            <Plus />
            New Customer
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
                <TableHead>Type</TableHead>
                <TableHead>City</TableHead>
                <TableHead>PIC</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.code}>
                  <TableCell className="font-medium">{c.code}</TableCell>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.type}</TableCell>
                  <TableCell>{c.city}</TableCell>
                  <TableCell>{c.pic}</TableCell>
                  <TableCell>
                    <Badge
                      variant={c.status === "Active" ? "secondary" : "outline"}
                    >
                      {c.status}
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
