import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { featureAllowed } from "@/lib/feature-guard";
import { canUnggahBuktiPembayaran } from "@/lib/bukti-pembayaran-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { BuktiView } from "@/components/bukti-pembayaran/bukti-view";
import type { DaftarBukti } from "@/components/bukti-pembayaran/types";

export const dynamic = "force-dynamic";

// F32 Bukti Pembayaran — arsip foto bukti bayar bertanda kode pengajuan. Tanpa OCR/WA/Accurate
// (keputusan Direktur 2026-10-19); accounting merekonsiliasi sendiri. Kunci izin 'bukti-pembayaran'
// (view = lihat & unduh, create = unggah), tertutup default: butuh Sync Fitur + centang Akses Grup.
export default async function BuktiPembayaranPage() {
  const me = await sessionUser();
  if (!me || !featureAllowed(me, "/bukti-pembayaran", "view")) {
    return (
      <>
        <PageHeader title="Bukti Pembayaran" />
        <EmptyState title="Tidak punya akses" description="Menu ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }

  let awal: DaftarBukti | null = null;
  let pending = false;
  try {
    const r = await gatewayFetch("/bukti-pembayaran?limit=25");
    if (r.status === 503) pending = true;
    else if (r.ok) awal = (await r.json()) as DaftarBukti;
  } catch { awal = null; }

  return (
    <>
      <PageHeader
        title="Bukti Pembayaran"
        description="Unggah foto bukti pembayaran beserta kode pengajuannya. Pencocokan ke pengajuan dilakukan tim accounting. (F32)"
      />
      {pending ? (
        <EmptyState title="Fitur belum siap" description="Migrasi 238 (bukti_pembayaran) belum diterapkan di database ini." />
      ) : (
        <BuktiView awal={awal} canUnggah={canUnggahBuktiPembayaran(me)} />
      )}
    </>
  );
}
