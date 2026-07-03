import { PageHeader } from "@/components/dashboard/page-header";
import { SalesTargetForm } from "@/components/sales/sales-target-form";

export const dynamic = "force-dynamic";

export default function SalesTargetsPage() {
  return (
    <>
      <PageHeader
        title="Sales Targets"
        description="Set target penjualan East/West per tahun (Tahunan/Kuartalan/Bulanan). Dipakai kartu Sales Performance untuk hitung % pencapaian."
      />
      <SalesTargetForm />
    </>
  );
}
