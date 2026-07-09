import { redirect } from "next/navigation";

// Sales Performance dikonsolidasi ke Sales Analytics (F127). Menu /sales dipensiun;
// route ini redirect permanen supaya bookmark/deep-link lama tidak 404. Tab lama
// dipetakan ke view Analytics yang setara. (/sales/targets tetap route terpisah.)
const TAB_TO_VIEW: Record<string, string> = {
  customer: "per-customer",
  salesman: "per-am",
  cabang: "per-cabang",
  product: "per-produk",
  pengadaan: "per-pengadaan",
};

export default async function SalesRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const view = tab ? TAB_TO_VIEW[tab] : undefined;
  redirect(view ? `/sales-analytics?view=${view}` : "/sales-analytics");
}
