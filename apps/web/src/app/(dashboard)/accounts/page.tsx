import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { findNavItem, navOwnVisible, tabVisible } from "@/lib/nav";
import { pilihTab, type DefTab } from "@/lib/page-tabs";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageTabs } from "@/components/layout/page-tabs";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountsTable, type AccountRow } from "@/components/accounts/accounts-table";
import { CustomersRevenueView, type CustomersRevenue } from "@/components/customers/customers-revenue-view";
import { ChurnView, type ChurnData } from "@/components/customers/churn-view";
import { WinBackView, type DormantCustomer } from "@/components/sales/win-back-view";

export const dynamic = "force-dynamic";

// x-user-id → row-level scope by pemilik akun (crm_account.owner_am_id):
// AM = akun miliknya, HoD = akun AM di cabang timnya, admin = semua.
async function get<T>(path: string, userId?: string): Promise<T | null> {
  try {
    const r = await gatewayFetch(path, userId ? { headers: { "x-user-id": userId } } : undefined);
    return r.ok ? ((await r.json()) as T) : null;
  } catch { return null; }
}

const kosong = (title: string, description: string) => (
  <Card><CardContent className="pt-6"><EmptyState title={title} description={description} /></CardContent></Card>
);
const gagal = kosong("Data tidak tersedia", "Data gagal dimuat. Coba muat ulang halaman.");

// Customer & Akun (K9, evaluasi menu 19 Nov 2026): Accounts (profil faskes + kontak)
// dan Customers (revenue, churn, win-back dari faktur Accurate) dilebur. Tab Akun =
// key `accounts` (induk); tab Revenue/Churn/Win-back = key `customers` (entri
// features; /customers → ?tab=revenue). Hanya tab aktif yang datanya diambil.
export default async function CustomerAkunPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const [{ tab }, me] = await Promise.all([searchParams, sessionUser()]);
  const induk = findNavItem("/accounts");
  const fCust = induk?.features?.find((f) => f.key === "customers");
  const tabs: DefTab[] = [];
  if (!induk || navOwnVisible(me, induk)) tabs.push({ key: "akun", label: "Akun" });
  if (fCust && tabVisible(me, fCust)) {
    tabs.push({ key: "revenue", label: "Revenue" }, { key: "churn", label: "Churn (Deteksi Dini)" }, { key: "winback", label: "Win-back (Tidak Aktif)" });
  }
  const aktif = pilihTab(tabs, tab) ?? "akun";

  let isi: React.ReactNode;
  if (aktif === "revenue") {
    const rev = await get<CustomersRevenue>("/customers/revenue", me?.id);
    isi = !rev ? gagal
      : rev.customers.length === 0 ? kosong("Belum ada faktur", "Belum ada faktur Accurate — tunggu sinkron Accurate berikutnya.")
      : <CustomersRevenueView data={rev} />;
  } else if (aktif === "churn") {
    const churn = await get<ChurnData>("/customers/churn?days=60", me?.id);
    isi = churn ? <ChurnView data={churn} /> : gagal;
  } else if (aktif === "winback") {
    const dorm = await get<{ customers: DormantCustomer[] }>("/customers/dormant?days=30", me?.id);
    isi = dorm ? <WinBackView customers={dorm.customers} /> : gagal;
  } else {
    const d = await get<{ accounts: AccountRow[] }>("/accounts", me?.id);
    isi = d ? <Card><CardContent className="pt-6"><AccountsTable accounts={d.accounts} /></CardContent></Card> : gagal;
  }

  return (
    <>
      <PageHeader
        title="Customer & Akun"
        description="Profil faskes/akun + kontak multi-stakeholder, revenue per pelanggan, deteksi dini churn, dan win-back pelanggan tidak aktif. Sumber Accurate."
      />
      <PageTabs tabs={tabs.length ? tabs : [{ key: "akun", label: "Akun" }]} aktif={aktif} />
      {isi}
    </>
  );
}
