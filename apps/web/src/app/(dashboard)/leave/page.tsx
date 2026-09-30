import { gatewayFetch } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddLeaveSheet } from "@/components/crm/add-leave-sheet";
import { LeaveTable } from "@/components/tables/leave-table";
import { PendingLeaveTable, type PendingLeave } from "@/components/tables/pending-leave-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BackupUser } from "@/components/crm/backup-pic-field";

export const dynamic = "force-dynamic";

interface Leave {
  id: string;
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: string;
  keterangan: string | null;
  source: string;
  backup_am_id: string | null;
}

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await gatewayFetch(`${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function LeavePage() {
  const [leaveRes, usersRes, pendingRes] = await Promise.all([
    getJson<{ leave: Leave[] }>("/leave"),
    getJson<{ users: BackupUser[] }>("/master/users"),
    getJson<{ pending: PendingLeave[] }>("/leave/pending"),
  ]);
  const leave = leaveRes?.leave ?? null;
  const pending = pendingRes?.pending ?? [];
  const nameById: Record<string, string> = {};
  const users = usersRes?.users ?? [];
  for (const u of users) nameById[u.am_id] = u.panggilan ?? u.nama;

  return (
    <>
      <PageHeader title="Manage Leave" description="Cuti / sakit / izin karyawan + pengganti (backup PIC). Pending = terdeteksi otomatis dari grup HRD, perlu di-approve." action={<AddLeaveSheet />} />

      {pending.length > 0 && (
        <Card className="mb-4 border-amber-300 dark:border-amber-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">⏳ Pending Approval ({pending.length}) — terdeteksi dari grup HRD</CardTitle>
          </CardHeader>
          <CardContent>
            <PendingLeaveTable pending={pending} users={users} />
          </CardContent>
        </Card>
      )}

      {!leave ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : leave.length === 0 ? (
        <p className="text-muted-foreground">Belum ada catatan cuti. Tambah via tombol di atas atau approve pending.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <LeaveTable leave={leave} nameById={nameById} users={users} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
