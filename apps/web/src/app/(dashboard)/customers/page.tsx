import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface Customer {
  customer_id: string;
  customer_name: string;
  deal_count: number;
  total_value: number;
  ams: string[];
  stages: string[];
  last_activity: string;
}

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

async function getCustomers(): Promise<Customer[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/customers`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { customers: Customer[] };
    return data.customers;
  } catch {
    return null;
  }
}

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <>
      <PageHeader
        title="Customers"
        description="Customer aktif diturunkan dari pipeline deal — data live dari DB."
      />

      {!customers ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan{" "}
          <code>DATABASE_URL</code>.
        </p>
      ) : customers.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada customer. Kirim <code>#PLAN</code> via <code>/api/plan</code> untuk
          membuat deal pertama.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead className="text-right">Deal</TableHead>
                  <TableHead className="text-right">Nilai</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>AM</TableHead>
                  <TableHead>Aktivitas terakhir</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.customer_id}>
                    <TableCell className="font-medium">{c.customer_name}</TableCell>
                    <TableCell className="text-right">{c.deal_count}</TableCell>
                    <TableCell className="text-right">
                      {c.total_value ? rupiah(c.total_value) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {c.stages.map((s) => (
                          <Badge key={s} variant="secondary">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.ams.join(", ")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tanggal(c.last_activity)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
