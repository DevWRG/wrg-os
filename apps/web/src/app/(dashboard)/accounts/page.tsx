import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountsTable, type AccountRow } from "@/components/accounts/accounts-table";

export const dynamic = "force-dynamic";

async function get<T>(path: string): Promise<T | null> {
  try { const r = await gatewayFetch(path); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

export default async function AccountsPage() {
  const d = await get<{ accounts: AccountRow[] }>("/accounts");
  return (
    <>
      <PageHeader
        title="Accounts"
        description="Profil faskes/account (CRM Fase 1): ringkasan komersial (revenue/AR) + kontak multi-stakeholder. Master dari Accurate."
      />
      {!d ? (
        <Card><CardContent className="pt-6"><EmptyState title="Data tidak tersedia" description="Pastikan apps/api jalan & data Accurate ter-sync." /></CardContent></Card>
      ) : (
        <Card><CardContent className="pt-6"><AccountsTable accounts={d.accounts} /></CardContent></Card>
      )}
    </>
  );
}
