import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { CustomersTable } from "@/components/tables/customers-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Customer {
  customer_id: string;
  customer_name: string;
  deal_count: number;
  total_value: number;
  ams: string[];
  stages: string[];
  last_activity: string;
}

async function getCustomers(): Promise<Customer[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/customers`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { customers: Customer[] }).customers;
  } catch {
    return null;
  }
}

export default async function CustomersPage() {
  const customers = await getCustomers();

  return (
    <>
      <PageHeader title="Customers" description="Customer aktif diturunkan dari pipeline deal — data live dari DB." />
      {!customers ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : customers.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada customer. Kirim <code>#PLAN</code> via <code>/api/plan</code> untuk membuat deal pertama.
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <CustomersTable customers={customers} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
