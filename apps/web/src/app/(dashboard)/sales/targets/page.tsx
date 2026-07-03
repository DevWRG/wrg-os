import { PageHeader } from "@/components/dashboard/page-header";
import { SalesTargetForm } from "@/components/sales/sales-target-form";

export const dynamic = "force-dynamic";

export default function SalesTargetsPage() {
  return (
    <>
      <PageHeader
        title="Sales Targets"
        description="Set target penjualan per region (East/West × Tahunan/Kuartalan/Bulanan), per cabang, & per AM (tahunan). Region cabang/AM diturunkan dari Territory. Nilai dalam Rupiah."
      />
      <SalesTargetForm />
    </>
  );
}
