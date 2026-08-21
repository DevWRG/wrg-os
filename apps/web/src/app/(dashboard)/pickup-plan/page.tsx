import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddPickupPlanSheet, type AccountOption } from "@/components/crm/add-pickup-plan-sheet";
import { PickupPlanTable, type PickupPlan } from "@/components/tables/pickup-plan-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

async function getPlans(): Promise<PickupPlan[] | null> {
  try {
    const res = await gatewayFetch(`/pickup-plan?limit=500`);
    if (!res.ok) return null;
    return ((await res.json()) as { plans: PickupPlan[] }).plans;
  } catch {
    return null;
  }
}

// Daftar akun untuk picker customer. Sengaja diambil di server: yang dipilih
// user tersimpan sebagai account_id di plan, jadi cron tak perlu menebak akun
// dari nama customer (lihat komentar migrasi 081).
//
// `x-user-id` WAJIB diteruskan — /accounts di api memakai scopeOf(c), dan
// resolveScope("") jatuh ke FULL_SCOPE. Tanpa header ini picker memuat SELURUH
// customer perusahaan, termasuk akun milik AM lain yang row-level scope F122
// sengaja sembunyikan di halaman /accounts. Pola sama BFF resmi
// apps/web/src/app/api/accounts/[...path]/route.ts.
async function getAccounts(userId: string | null): Promise<AccountOption[]> {
  try {
    const res = await gatewayFetch(`/accounts`, userId ? { headers: { "x-user-id": userId } } : undefined);
    if (!res.ok) return [];
    const data = (await res.json()) as { accounts: { id: string; name: string; contacts: number }[] };
    return data.accounts.map((a) => ({ id: a.id, name: a.name, contacts: a.contacts }));
  } catch {
    return [];
  }
}

export default async function PickupPlanPage() {
  const me = await sessionUser();
  const [plans, accounts] = await Promise.all([getPlans(), getAccounts(me?.id ?? null)]);

  return (
    <>
      <PageHeader
        title="Jadwal Kirim-Tagih"
        description="Rencana trip kurir + cek otomatis H-1: hari libur (master_holiday) & PIC customer beserta backup-nya. Mencegah rebound trip."
        action={<AddPickupPlanSheet accounts={accounts} />}
      />
      {!plans ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : plans.length === 0 ? (
        <p className="text-muted-foreground">
          Belum ada jadwal trip. Tambah lewat tombol di atas — cek H-1 jalan otomatis sore hari sebelum
          tanggal trip (butuh <code>PREVISIT_CHECK_ENABLED=true</code>).
        </p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <PickupPlanTable plans={plans} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
