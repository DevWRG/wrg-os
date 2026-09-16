import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AddPrintSpecSheet } from "@/components/shipping/add-print-spec-sheet";
import { PrintSpecTable, type PrintSpecRow } from "@/components/shipping/print-spec-table";

export const dynamic = "force-dynamic";

async function getRows(): Promise<PrintSpecRow[] | null> {
  try {
    const res = await gatewayFetch("/print-specs");
    if (!res.ok) return null;
    return (await res.json()) as PrintSpecRow[];
  } catch {
    return null;
  }
}

// F44 Document Print Spec Standardizer — standalone (lihat migrasi 096).
export default async function PrintSpecPage() {
  const rows = await getRows();
  return (
    <>
      <PageHeader
        title="Spesifikasi Cetak Dokumen"
        description="Standar cetak (ukuran kertas, margin, font, header/footer) per jenis dokumen (F44)."
        action={<AddPrintSpecSheet />}
      />
      {rows === null ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Belum ada spec cetak. Tambah via tombol di atas.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <PrintSpecTable rows={rows} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
