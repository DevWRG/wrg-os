import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { RevenueStreamView, type StreamPayload } from "@/components/revenue-stream/revenue-stream-view";

export const dynamic = "force-dynamic";

// Revenue per lini produk (endpoint /reports/revenue-by-stream, PR #856).
// Gate rute ditegakkan layout dashboard lewat katalog NAV — tak ada gate tambahan
// di sini.
const MONTH = /^\d{4}-\d{2}$/;

export default async function RevenueStreamPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>;
}) {
  const sp = await searchParams;
  // Periode divalidasi di sini SEBELUM masuk query string: nilai sembarang dari URL
  // akan diabaikan endpoint dan diam-diam jatuh ke bulan berjalan, sehingga dropdown
  // menampilkan periode yang berbeda dari data yang tampil.
  const now = new Date();
  const bulanIni = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const periode = sp.periode && MONTH.test(sp.periode) ? sp.periode : bulanIni;

  let data: StreamPayload | null = null;
  try {
    const res = await gatewayFetch(`/reports/revenue-by-stream?periode=${periode}`);
    if (res.ok) data = (await res.json()) as StreamPayload;
  } catch {
    data = null;
  }

  return (
    <>
      <PageHeader
        title="Revenue per Lini Produk"
        description="Revenue dipecah per lini produk dari baris faktur Accurate, memakai klasifikasi pricebook. Cakupan klasifikasi dan selisih terhadap netto invoice Sales Analytics ditampilkan apa adanya — angka per lini hanya membagi porsi yang terklasifikasi."
      />
      <RevenueStreamView data={data} periode={periode} />
    </>
  );
}
