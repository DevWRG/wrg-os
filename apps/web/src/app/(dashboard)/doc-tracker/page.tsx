import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canEditDocTracker, canViewDocTracker } from "@/lib/doc-tracker-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { DocTrackerView } from "@/components/doc-tracker/doc-tracker-view";
import type { DocTrackerList } from "@/components/doc-tracker/types";

export const dynamic = "force-dynamic";

// DOC Document Tracker — 9 state per Sales Order: Draft → Review → Approved → Sent → Received → Executed → Billed → Paid → Closed.
// Dihitung dari data yang sudah ada (SO/SJ/BAST/faktur); hanya stempel Review/Approved, checklist ttd, dan tautan faktur yang dicatat.
// Kunci izin sendiri 'doc-tracker' (lib/doc-tracker-access.ts); menstempel = aksi edit.
export default async function DocTrackerPage() {
  const me = await sessionUser();
  if (!canViewDocTracker(me)) {
    return (
      <>
        <PageHeader title="Document Tracker" />
        <EmptyState title="Tidak punya akses" description="Fitur ini dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: DocTrackerList | null = null;
  try {
    const r = await gatewayFetch("/doc-tracker");
    if (r.ok) data = (await r.json()) as DocTrackerList;
  } catch {
    data = null;
  }

  return (
    <>
      <PageHeader
        title="Document Tracker"
        description="Rekap dokumen tiap transaksi — sudah ada atau belum — untuk menyatakan statusnya, dari order masuk sampai dibayar dan ditutup."
      />
      {!data
        ? <EmptyState title="Data tidak dapat dimuat" description="Backend tidak terjangkau atau migrasi belum diterapkan. Coba muat ulang beberapa saat lagi." />
        : <DocTrackerView data={data} canEdit={canEditDocTracker(me)} />}
    </>
  );
}
