import { FileDown } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canViewReportLibrary, LAPORAN } from "@/lib/report-library";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Pratinjau {
  judul: string;
  ringkasan: { label: string; nilai: string }[];
  header: string[];
  total_baris: number;
  baris: string[][];
}

// F92 Report Library — 6 laporan eksekutif dalam satu halaman. Setiap bagian memakai data
// yang sama dengan halaman sumbernya (lihat apps/api/src/repo/report-library.ts); bagian
// yang menu sumbernya tak boleh dibuka user ini disembunyikan, bukan ditampilkan kosong.
export default async function ReportLibraryPage() {
  const me = await sessionUser();
  if (!me || !canViewReportLibrary(me)) {
    return (
      <>
        <PageHeader title="Report Library" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  const boleh = LAPORAN.filter((l) => featureAllowed(me, l.menu, "view"));
  const hasil = await Promise.all(
    boleh.map(async (l) => {
      try {
        const r = await gatewayFetch(`/report-library/${l.key}`, { headers: { "x-user-id": me.id } });
        return { l, data: r.ok ? ((await r.json()) as Pratinjau) : null };
      } catch {
        return { l, data: null };
      }
    }),
  );

  return (
    <>
      <PageHeader
        title="Report Library"
        description="Enam laporan eksekutif dalam satu tempat. Angkanya sama dengan halaman sumbernya; unduh PDF untuk dibawa ke rapat."
      />
      {hasil.length === 0 ? (
        <EmptyState title="Belum ada laporan yang bisa dibuka" description="Laporan mengikuti izin menu sumbernya (WatchPoint, Pipeline, AR, Stok Gudang, Product Scorecard, Customers)." />
      ) : (
        <div className="space-y-6">
          {hasil.map(({ l, data }) => (
            <Card key={l.key}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base font-semibold tracking-tight">{l.judul}</CardTitle>
                  <p className="text-muted-foreground text-xs">{l.deskripsi}</p>
                </div>
                {data && data.total_baris > 0 && (
                  <a href={`/api/report-library/${l.key}/pdf`} download className={cn(buttonVariants({ size: "sm" }))}>
                    <FileDown className="size-4" /> Export PDF
                  </a>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {!data ? (
                  <p className="text-muted-foreground text-sm">Data laporan gagal dimuat. Coba muat ulang halaman.</p>
                ) : (
                  <>
                    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      {data.ringkasan.map((r) => (
                        <div key={r.label} className="flex justify-between gap-2 border-b py-1">
                          <dt className="text-muted-foreground">{r.label}</dt>
                          <dd className="font-medium tabular-nums">{r.nilai}</dd>
                        </div>
                      ))}
                    </dl>
                    {data.total_baris === 0 ? (
                      <p className="text-muted-foreground text-sm">Belum ada data.</p>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>{data.header.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                            </TableHeader>
                            <TableBody>
                              {data.baris.map((b, i) => (
                                <TableRow key={i}>{b.map((s, k) => <TableCell key={k} className="whitespace-nowrap">{s}</TableCell>)}</TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="text-muted-foreground text-xs">
                          {data.total_baris > data.baris.length
                            ? `Menampilkan ${data.baris.length} dari ${data.total_baris} baris — PDF memuat semuanya.`
                            : `${data.total_baris} baris.`}
                        </p>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
