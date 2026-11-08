import Link from "next/link";
import { ChevronRight, FileDown } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canViewReportLibrary, LAPORAN } from "@/lib/report-library";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Pratinjau {
  ringkasan: { label: string; nilai: string }[];
  total_baris: number;
}

/** Angka ringkasan yang tampil di kartu; sisanya di halaman detail. */
const RINGKASAN_KARTU = 3;

// F92 Report Library — 6 laporan eksekutif sebagai kartu; klik kartu → /report-library/<key>
// (ringkasan lengkap + tabel berpaginasi). Setiap laporan memakai data yang sama dengan
// halaman sumbernya (apps/api/src/repo/report-library.ts); laporan yang menu sumbernya
// tak boleh dibuka user ini disembunyikan, bukan ditampilkan kosong.
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
        description="Enam laporan eksekutif dalam satu tempat. Angkanya sama dengan halaman sumbernya; klik kartu untuk rincian, atau unduh PDF untuk dibawa ke rapat."
        action={hasil.length > 0 ? (
          <a href="/api/report-library/semua/pdf" download className={cn(buttonVariants({ size: "sm" }))}>
            <FileDown className="size-4" /> Export semua (1 PDF)
          </a>
        ) : undefined}
      />
      {hasil.length === 0 ? (
        <EmptyState title="Belum ada laporan yang bisa dibuka" description="Laporan mengikuti izin menu sumbernya (WatchPoint, Pipeline, AR, Stok Gudang, Product Scorecard, Customers)." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {hasil.map(({ l, data }) => (
            <Card key={l.key} className="relative flex flex-col transition-colors hover:border-primary/50">
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center justify-between gap-2 text-base font-semibold tracking-tight">
                  {/* Tautan menutup seluruh kartu lewat ::after; tombol PDF di atasnya (z-10). */}
                  <Link href={`/report-library/${l.key}`} className="after:absolute after:inset-0 after:content-['']">
                    {l.judul}
                  </Link>
                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </CardTitle>
                <p className="text-muted-foreground text-xs">{l.deskripsi}</p>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                {!data ? (
                  <p className="text-muted-foreground text-sm">Data laporan gagal dimuat.</p>
                ) : (
                  <dl className="space-y-1 text-sm">
                    {data.ringkasan.slice(0, RINGKASAN_KARTU).map((r) => (
                      <div key={r.label} className="flex justify-between gap-2 border-b py-1">
                        <dt className="text-muted-foreground">{r.label}</dt>
                        <dd className="font-medium tabular-nums">{r.nilai}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground text-xs">{data ? `${data.total_baris} baris` : "—"}</span>
                  {data && data.total_baris > 0 && (
                    <a href={`/api/report-library/${l.key}/pdf`} download className={cn(buttonVariants({ size: "sm", variant: "outline" }), "relative z-10")}>
                      <FileDown className="size-4" /> PDF
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
