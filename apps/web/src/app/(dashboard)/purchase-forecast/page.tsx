import { redirect } from "next/navigation";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewPurchaseForecast } from "@/lib/purchase-forecast-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddPurchaseForecastSheet } from "@/components/crm/add-purchase-forecast-sheet";
import { PurchaseForecastTable, type PurchaseForecast } from "@/components/tables/purchase-forecast-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

// F41 — jaring kedua di server (nav.ts `show` sudah menyembunyikan menu),
// pola sama pricebook/ringkasan/page.tsx: kalau item nav berubah/salah cocok,
// halaman ini tidak boleh telanjur merender data forecast.
async function getRows(): Promise<PurchaseForecast[] | null> {
  try {
    const res = await gatewayFetch("/purchase-forecast");
    if (!res.ok) return null;
    return ((await res.json()) as { rows: PurchaseForecast[] }).rows;
  } catch {
    return null;
  }
}

export default async function PurchaseForecastPage() {
  const me = await sessionUser();
  if (!canViewPurchaseForecast(me)) {
    redirect("/akses-ditolak?menu=Forecast%20vs%20Actual%20PO");
  }

  const rows = await getRows();

  return (
    <>
      <PageHeader
        title="Forecast vs Actual PO"
        description="Gap rencana pembelian (forecast) vs realisasi Purchase Order per periode+lini bisnis. (F41)"
        action={<AddPurchaseForecastSheet />}
      />
      {!rows ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground">Belum ada forecast. Tambah rencana pembelian per periode dulu.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <PurchaseForecastTable rows={rows} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
