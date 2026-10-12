import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountDetail, type AccountData, type OwnerOption } from "@/components/accounts/account-detail";
import type { TimelinePage } from "@/components/accounts/account-timeline";

export const dynamic = "force-dynamic";

// x-user-id → row-level scope: account milik AM lain balas 404 dari backend,
// jadi halaman ini apa adanya menampilkan "tak ditemukan".
async function get<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const r = await gatewayFetch(path, userId ? { headers: { "x-user-id": userId } } : undefined);
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, me] = await Promise.all([params, sessionUser()]);
  // Kandidat pemilik hanya terisi utk yg berhak memindah kepemilikan (admin =
  // semua AM, HoD = AM cabang timnya, AM = kosong → field pemilik read-only).
  const [d, owners, timeline] = await Promise.all([
    get<AccountData>(`/accounts/${encodeURIComponent(id)}`, me?.id),
    get<{ owners: OwnerOption[] }>(`/accounts-owners`, me?.id),
    get<TimelinePage>(`/accounts/${encodeURIComponent(id)}/timeline?limit=50`, me?.id),
  ]);
  return (
    <>
      <PageHeader title={d?.name ?? "Account"} description="Profil account 360 (CRM Fase 1) — ringkasan komersial, kontak multi-stakeholder, dan timeline interaksi." />
      {!d ? (
        <Card><CardContent className="pt-6"><EmptyState title="Account tak ditemukan" description="Account ini tak ada di master Accurate, atau bukan milik Anda." /></CardContent></Card>
      ) : (
        <AccountDetail account={d} owners={owners?.owners ?? []} timeline={timeline} />
      )}
    </>
  );
}
