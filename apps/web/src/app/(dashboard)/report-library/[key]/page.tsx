import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, FileDown } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canViewReportLibrary, laporanByKey } from "@/lib/report-library";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TabelLaporan } from "@/components/report-library/tabel-laporan";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Pratinjau {
  ringkasan: { label: string; nilai: string }[];
  header: string[];
  total_baris: number;
  baris: string[][];
}

// F92 — detail satu laporan: ringkasan lengkap + tabel berpaginasi server + Export PDF.
// Gerbang = menu Report Library DAN menu sumber laporan (sama dengan BFF-nya), jadi URL
// yang diketik langsung tak membuka laporan yang disembunyikan di halaman kartu.
export default async function DetailLaporanPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const l = laporanByKey(key);
  if (!l) notFound();
  const me = await sessionUser();
  if (!me || !canViewReportLibrary(me) || !featureAllowed(me, l.menu, "view")) {
    redirect(`/akses-ditolak?menu=${encodeURIComponent(l.judul)}`);
  }

  let data: Pratinjau | null = null;
  try {
    const r = await gatewayFetch(`/report-library/${l.key}`, { headers: { "x-user-id": me.id } });
    data = r.ok ? ((await r.json()) as Pratinjau) : null;
  } catch {
    data = null;
  }

  return (
    <>
      <Link href="/report-library" className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> Report Library
      </Link>
      <PageHeader
        title={l.judul}
        description={l.deskripsi}
        action={data && data.total_baris > 0 ? (
          <a href={`/api/report-library/${l.key}/pdf`} download className={cn(buttonVariants({ size: "sm" }))}>
            <FileDown className="size-4" /> Export PDF
          </a>
        ) : undefined}
      />
      {!data ? (
        <p className="text-muted-foreground text-sm">Data laporan gagal dimuat. Coba muat ulang halaman.</p>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-4">
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {data.ringkasan.map((r) => (
                  <div key={r.label} className="flex justify-between gap-2 border-b py-1">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-medium tabular-nums">{r.nilai}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-4">
              {data.total_baris === 0 ? (
                <p className="text-muted-foreground text-sm">Belum ada data.</p>
              ) : (
                <TabelLaporan laporanKey={l.key} header={data.header} barisAwal={data.baris} total={data.total_baris} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
