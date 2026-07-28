import Link from "next/link";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface VisitDetail {
  id: string;
  am_id: string;
  nama: string | null;
  customer_name: string | null;
  photo_url: string | null;
  visit_lat: number | null;
  visit_lon: number | null;
  visit_timestamp: string | null;
  visit_date: string | null;
  geo_status: string;
  created_at: string;
  note: string | null;
}

const GEO_LABEL: Record<string, string> = {
  ok: "Valid",
  out_of_bounds: "Di luar Indonesia",
  no_geo: "Tanpa GPS",
  date_mismatch: "Tanggal tak cocok",
};
const geoTone = (s: string): "default" | "secondary" | "destructive" | "outline" =>
  s === "ok" ? "secondary" : s === "no_geo" ? "outline" : "destructive";

// x-user-id → backend scope; visit milik AM lain balas 404 (bukan "ada tapi
// ditolak"), jadi halaman ini apa adanya menampilkan "tak ditemukan".
async function getVisit(id: string, userId?: string): Promise<VisitDetail | null> {
  try {
    const res = await gatewayFetch(
      `/visits/${encodeURIComponent(id)}`,
      userId ? { headers: { "x-user-id": userId } } : undefined,
    );
    if (!res.ok) return null;
    return (await res.json()) as VisitDetail;
  } catch {
    return null;
  }
}

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me] = await Promise.all([params, sessionUser()]);
  const v = await getVisit(id, me?.id);

  return (
    <>
      <PageHeader
        title="Detail Kunjungan"
        description={v ? `${v.nama ?? v.am_id} — ${v.customer_name ?? "tanpa customer"}` : "Kunjungan tidak ditemukan"}
        action={
          <Link href="/visits" className="text-sm text-[#0066cc] hover:underline">
            ← Kembali ke Visits
          </Link>
        }
      />

      {!v ? (
        <p className="text-muted-foreground">Kunjungan tidak ditemukan.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Info</span>
                <Badge variant={geoTone(v.geo_status)}>{GEO_LABEL[v.geo_status] ?? v.geo_status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">AM:</span> <span className="font-medium">{v.nama ?? v.am_id}</span></div>
              <div><span className="text-muted-foreground">Customer:</span> {v.customer_name ?? "—"}</div>
              <div><span className="text-muted-foreground">Tanggal kunjungan:</span> {v.visit_date ?? "—"}</div>
              <div><span className="text-muted-foreground">Timestamp foto:</span> {v.visit_timestamp ?? "—"}</div>
              <div>
                <span className="text-muted-foreground">Koordinat:</span>{" "}
                {v.visit_lat !== null && v.visit_lon !== null ? (
                  <a
                    className="text-[#0066cc] hover:underline"
                    href={`https://www.google.com/maps?q=${v.visit_lat},${v.visit_lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {v.visit_lat.toFixed(5)}, {v.visit_lon.toFixed(5)} ↗
                  </a>
                ) : (
                  "—"
                )}
              </div>
              {v.note ? <div><span className="text-muted-foreground">Catatan:</span> {v.note}</div> : null}
              <div className="pt-1 text-xs text-muted-foreground">Dicatat: {v.created_at}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Foto</CardTitle></CardHeader>
            <CardContent>
              {v.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/media?p=${encodeURIComponent(v.photo_url)}`} alt="foto kunjungan" className="max-h-[480px] w-full rounded-md object-contain" />
              ) : (
                <p className="text-muted-foreground text-sm">Tidak ada foto.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
