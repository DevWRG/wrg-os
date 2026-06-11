import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddVisitSheet } from "@/components/crm/add-visit-sheet";
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

interface VisitItem {
  id: string;
  am_id: string;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
  created_at: string;
}
interface VisitResponse {
  count: number;
  visits: VisitItem[];
}

const GEO_LABEL: Record<string, string> = {
  ok: "Valid",
  out_of_bounds: "Di luar Indonesia",
  no_geo: "Tanpa GPS",
  date_mismatch: "Tanggal tak cocok",
};

const geoTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "ok" ? "secondary" : s === "no_geo" ? "outline" : "destructive";

const tanggal = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};

async function getVisits(): Promise<VisitItem[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/visits`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as VisitResponse).visits;
  } catch {
    return null;
  }
}

export default async function VisitsPage() {
  const visits = await getVisits();

  const total = visits?.length ?? 0;
  const ok = visits?.filter((v) => v.geo_status === "ok").length ?? 0;
  const flagged = visits?.filter((v) => v.geo_status === "out_of_bounds" || v.geo_status === "date_mismatch").length ?? 0;

  return (
    <>
      <PageHeader
        title="Visits"
        description="Kunjungan AM dengan geotag + foto (port visit). Geo divalidasi terhadap bbox Indonesia."
        action={<AddVisitSheet />}
      />

      {!visits ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : total === 0 ? (
        <p className="text-muted-foreground">
          Belum ada kunjungan. Catat via <code>POST /visits</code>.
        </p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Total kunjungan</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{total}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Geo valid</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{ok}</div>
                <p className="text-muted-foreground text-xs">{total > 0 ? Math.round((ok / total) * 100) : 0}% dari total</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-muted-foreground text-sm font-medium">Perlu ditinjau</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-xl font-semibold">{flagged}</div>
                <p className="text-muted-foreground text-xs">di luar bbox / tanggal tak cocok</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>AM</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Koordinat</TableHead>
                    <TableHead>Foto</TableHead>
                    <TableHead>Geo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.am_id}</TableCell>
                      <TableCell>{v.customer_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{tanggal(v.visit_date ?? v.visit_timestamp)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.visit_lat !== null && v.visit_lon !== null
                          ? `${v.visit_lat.toFixed(5)}, ${v.visit_lon.toFixed(5)}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {v.photo_url ? (
                          <a
                            href={v.photo_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary underline underline-offset-2"
                          >
                            lihat
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={geoTone(v.geo_status)}>{GEO_LABEL[v.geo_status] ?? v.geo_status}</Badge>
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
