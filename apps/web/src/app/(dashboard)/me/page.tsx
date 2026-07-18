import { PageHeader } from "@/components/dashboard/page-header";
import { MySalesView } from "@/components/my-sales-view";

export const dynamic = "force-dynamic";

// Kinerja Saya — 1 halaman, 2 tab (Revenue & AR), ber-scope ke akun login
// (AM=data sendiri, HoD=tim, admin=semua) via resolveScope di backend. Client
// component memuat data per-tab lewat BFF /api/sales-analytics/* (x-user-id ke-inject).
export default function MePage() {
  return (
    <>
      <PageHeader
        title="Kinerja Saya"
        description="Ringkasan revenue & piutang (AR) sesuai akun Anda — AM melihat data sendiri, HoD melihat timnya."
      />
      <MySalesView />
    </>
  );
}
