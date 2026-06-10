import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface Invoice {
  customer_id: string;
  customer_name: string | null;
  invoice_no: string;
  due_date: string;
  amount: number;
  days_overdue: number;
  bucket: string;
  is_anomaly: boolean;
}
interface Aging {
  total_outstanding: number;
  total_invoices: number;
  buckets: { bucket: string; count: number; total: number }[];
  invoices: Invoice[];
}

const BUCKET_ORDER = ["current", "1-30", "31-60", "61-90", "90+"];

const rupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

const bucketTone = (b: string): "default" | "secondary" | "destructive" | "outline" =>
  b === "90+" ? "destructive" : b === "61-90" ? "outline" : "secondary";

async function getAging(): Promise<Aging | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/ar/aging`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Aging;
  } catch {
    return null;
  }
}

export default async function ArAgingPage() {
  const data = await getAging();

  return (
    <>
      <PageHeader
        title="AR Aging"
        description="Piutang per bucket umur (D2) — feeder dari Accurate, data live dari DB."
      />

      {!data ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan{" "}
          <code>DATABASE_URL</code>.
        </p>
      ) : data.total_invoices === 0 ? (
        <p className="text-muted-foreground">
          Belum ada data piutang. Ingest via <code>POST /api/ar/invoices</code>.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Total Outstanding
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{rupiah(data.total_outstanding)}</div>
                <p className="text-muted-foreground text-xs">{data.total_invoices} invoice</p>
              </CardContent>
            </Card>
            {BUCKET_ORDER.map((b) => {
              const row = data.buckets.find((x) => x.bucket === b);
              return (
                <Card key={b}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-muted-foreground text-sm font-medium">
                      {b}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xl font-semibold">{rupiah(row?.total ?? 0)}</div>
                    <p className="text-muted-foreground text-xs">{row?.count ?? 0} invoice</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Jatuh tempo</TableHead>
                    <TableHead className="text-right">Nilai</TableHead>
                    <TableHead className="text-right">Overdue</TableHead>
                    <TableHead>Bucket</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.invoices.map((inv) => (
                    <TableRow key={`${inv.customer_id}-${inv.invoice_no}`}>
                      <TableCell className="font-medium">
                        {inv.customer_name ?? inv.customer_id}
                        {inv.is_anomaly && (
                          <Badge variant="destructive" className="ml-2">
                            anomali
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inv.invoice_no}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.due_date}</TableCell>
                      <TableCell className="text-right">{rupiah(inv.amount)}</TableCell>
                      <TableCell className="text-right">{inv.days_overdue} hari</TableCell>
                      <TableCell>
                        <Badge variant={bucketTone(inv.bucket)}>{inv.bucket}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
