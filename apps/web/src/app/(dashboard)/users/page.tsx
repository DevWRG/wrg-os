import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddUserSheet } from "@/components/crm/add-user-sheet";
import { UsersTable } from "@/components/tables/users-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface User {
  am_id: string;
  nama: string;
  panggilan: string | null;
  wa_number: string | null;
  role: string;
  posisi: string | null;
  cabang: string | null;
  area: string | null;
  aktif: boolean;
  wajib_plan_report: boolean;
}

async function getUsers(): Promise<User[] | null> {
  try {
    const res = await gatewayFetch(`/master/users`);
    if (!res.ok) return null;
    return ((await res.json()) as { users: User[] }).users;
  } catch {
    return null;
  }
}

export default async function UsersPage() {
  const users = await getUsers();
  const aktif = users?.filter((u) => u.aktif).length ?? 0;
  const wajib = users?.filter((u) => u.aktif && u.wajib_plan_report).length ?? 0;
  const am = users?.filter((u) => u.role === "AM").length ?? 0;

  return (
    <>
      <PageHeader title="Users" description="Roster karyawan (master_user) — di-key am_id, dipakai lintas plan/report/reminder/territory." action={<AddUserSheet />} />
      {!users ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : users.length === 0 ? (
        <p className="text-muted-foreground">Belum ada user. Tambah via <code>POST /master/users</code>.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Total user", users.length],
              ["Aktif · wajib report", `${aktif} · ${wajib}`],
              ["Account Manager (AM)", am],
            ].map(([k, v]) => (
              <Card key={String(k)}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-muted-foreground text-sm font-medium">{k}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-semibold">{v}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardContent className="pt-6">
              <UsersTable users={users} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}
