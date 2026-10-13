import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FakturPajakView } from "@/components/faktur-pajak/faktur-pajak-view";
import type { FpRow, Ringkasan } from "@/components/faktur-pajak/types";

export const dynamic = "force-dynamic";

// F27 Faktur Pajak / CoreTax Workflow — tracker FP per invoice: diminta → input CoreTax → disetujui →
// bukti. Kunci izin 'faktur-pajak' (view/create/edit), tertutup default. Pembuatan FP tetap di CoreTax.
export default async function FakturPajakPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/faktur-pajak", "view")) {
    return (
      <>
        <PageHeader title="Faktur Pajak" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: { items: FpRow[]; ringkasan: Ringkasan } | null = null;
  let pending = false;
  try {
    const r = await gatewayFetch("/faktur-pajak");
    if (r.status === 503) pending = true;
    else if (r.ok) data = (await r.json()) as { items: FpRow[]; ringkasan: Ringkasan };
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="Faktur Pajak"
        description="Tracker faktur pajak per invoice: diminta → diinput di CoreTax → disetujui → bukti. Batas terbit tanggal 15 bulan berikutnya. (F27)"
      />
      {pending
        ? <EmptyState title="Migrasi belum diterapkan" description="Tabel faktur pajak belum ada di database (migrasi 215)." />
        : !data
          ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
          : <FakturPajakView items={data.items} ringkasan={data.ringkasan}
              bolehAjukan={featureAllowed(me, "/faktur-pajak", "create")}
              bolehUbah={featureAllowed(me, "/faktur-pajak", "edit")} />}
    </>
  );
}
