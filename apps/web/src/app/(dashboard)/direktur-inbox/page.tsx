import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { canViewDirekturInbox } from "@/lib/direktur-inbox-access";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { InboxView } from "@/components/direktur-inbox/inbox-view";
import type { InboxHasil } from "@/components/direktur-inbox/types";

export const dynamic = "force-dynamic";

// F59 Direktur Inbox — gabungan antrean approval yang menunggu Direktur (PO, dana operasional,
// insentif, approval F11, lembur). Hanya membaca; memutuskan tetap di layar tiap sumber.
// Kunci izin sendiri 'direktur-inbox' (lib/direktur-inbox-access.ts).
export default async function DirekturInboxPage() {
  const me = await sessionUser();
  if (!canViewDirekturInbox(me)) {
    return (
      <>
        <PageHeader title="Direktur Inbox" />
        <EmptyState title="Tidak punya akses" description="Fitur ini untuk Direktur dan admin; dibuka lewat matriks Akses Grup." />
      </>
    );
  }
  let data: InboxHasil | null = null;
  try {
    const r = await gatewayFetch("/direktur-inbox");
    if (r.ok) data = (await r.json()) as InboxHasil;
  } catch { data = null; }

  return (
    <>
      <PageHeader
        title="Direktur Inbox"
        description="Semua yang menunggu keputusan Direktur dalam satu daftar — buka tiap item untuk memutuskan di layarnya."
      />
      {!data
        ? <EmptyState title="Backend tidak terjangkau" description="Coba muat ulang beberapa saat lagi." />
        : <InboxView data={data} />}
    </>
  );
}
