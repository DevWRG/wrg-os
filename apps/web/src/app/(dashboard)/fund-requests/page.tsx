import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { AddFundRequestSheet } from "@/components/ga/add-fund-request-sheet";
import { FundRequestTable, type FundRequestRow } from "@/components/ga/fund-request-table";

export const dynamic = "force-dynamic";

async function getFundRequests(): Promise<FundRequestRow[] | null> {
  try {
    const res = await gatewayFetch("/fund-requests");
    if (!res.ok) return null;
    return (await res.json()) as FundRequestRow[];
  } catch {
    return null;
  }
}

export default async function FundRequestsPage() {
  const rows = await getFundRequests();
  return (
    <>
      <PageHeader
        title="Pengajuan Dana Operasional"
        description="Ajukan dana operasional — mengalir HOD lalu Direktur (F138)."
        action={<AddFundRequestSheet />}
      />
      <Card>
        <CardContent className="pt-6">
          {!rows ? (
            <p className="text-muted-foreground">
              Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">Belum ada pengajuan dana operasional. Tambah via tombol di atas.</p>
          ) : (
            <FundRequestTable rows={rows} />
          )}
        </CardContent>
      </Card>
    </>
  );
}
