import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountDetail, type AccountData } from "@/components/accounts/account-detail";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export default async function AccountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await get<AccountData>(`/accounts/${encodeURIComponent(id)}`);
  return (
    <>
      <PageHeader title={d?.name ?? "Account"} description="Profil account 360 (CRM Fase 1) — ringkasan komersial + kontak multi-stakeholder." />
      {!d ? (
        <Card><CardContent className="pt-6"><EmptyState title="Account tak ditemukan" description="ID account tidak ada di master Accurate." /></CardContent></Card>
      ) : (
        <AccountDetail account={d} />
      )}
    </>
  );
}
