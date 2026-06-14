import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { PageHeader } from "@/components/dashboard/page-header";
import { UserAccessManager, type AppUserRow } from "@/components/crm/user-access-manager";

export const dynamic = "force-dynamic";

async function getJson<T>(path: string): Promise<T | null> {
  try { const res = await gatewayFetch(path); return res.ok ? ((await res.json()) as T) : null; } catch { return null; }
}

export default async function UserAccessPage() {
  const me = await sessionUser();
  if (!me || me.role !== "admin") {
    return (
      <>
        <PageHeader title="User Access" description="Manajemen akun login dashboard." />
        <p className="text-muted-foreground">Akses ditolak — hanya admin yang bisa mengelola akun login.</p>
      </>
    );
  }
  const [u, r] = await Promise.all([
    getJson<{ users: AppUserRow[] }>("/admin/users"),
    getJson<{ users: { am_id: string; nama?: string | null }[] }>("/master/users"),
  ]);
  return (
    <>
      <PageHeader title="User Access" description="Akun login dashboard: tambah, set/reset & kirim password (WA), role, aktif/nonaktif." />
      <UserAccessManager users={u?.users ?? []} roster={r?.users ?? []} />
    </>
  );
}
