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

interface CompetitorItem {
  id: string;
  am_id: string | null;
  customer_name: string | null;
  tanggal: string;
  vendor: string;
  produk: string | null;
  produk_kategori: string | null;
  harga_text: string | null;
  harga_numeric: number | null;
  konteks: string | null;
}
interface CompetitorResponse {
  count: number;
  items: CompetitorItem[];
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

async function getCompetitor(): Promise<CompetitorItem[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/competitor`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as CompetitorResponse).items;
  } catch {
    return null;
  }
}

export default async function CompetitorPage() {
  const items = await getCompetitor();

  const vendors = items ? new Set(items.map((i) => i.vendor)).size : 0;

  return (
    <>
      <PageHeader
        title="Competitor Intel"
        description={
          items && items.length > 0
            ? `${items.length} catatan dari ${vendors} kompetitor (port competitor_intel).`
            : "Intelijen kompetitor dari lapangan (port competitor_intel)."
        }
      />

      {!items ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada intel. Catat via <code>POST /competitor</code>.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Kompetitor</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-right">Harga</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Konteks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="text-muted-foreground">{tanggal(i.tanggal)}</TableCell>
                    <TableCell className="font-medium">{i.vendor}</TableCell>
                    <TableCell>
                      {i.produk ?? "—"}
                      {i.produk_kategori && (
                        <Badge variant="outline" className="ml-2">
                          {i.produk_kategori}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {i.harga_numeric !== null
                        ? rupiah(i.harga_numeric)
                        : (i.harga_text ?? "—")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{i.customer_name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">{i.konteks ?? "—"}</TableCell>
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
