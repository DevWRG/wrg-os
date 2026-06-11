import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddLeaveSheet } from "@/components/crm/add-leave-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

interface Leave {
  id: string;
  am_id: string;
  start_date: string;
  end_date: string;
  jenis: string;
  keterangan: string | null;
  source: string;
}
interface User {
  am_id: string;
  nama: string;
  panggilan: string | null;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
};
const jenisTone = (j: string): "default" | "secondary" | "destructive" | "outline" =>
  j === "sakit" ? "destructive" : j === "cuti" ? "secondary" : "outline";

async function getJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function LeavePage() {
  const [leaveRes, usersRes] = await Promise.all([
    getJson<{ leave: Leave[] }>("/leave"),
    getJson<{ users: User[] }>("/master/users"),
  ]);
  const leave = leaveRes?.leave ?? null;
  const nameById = new Map((usersRes?.users ?? []).map((u) => [u.am_id, u.panggilan ?? u.nama]));

  return (
    <>
      <PageHeader title="Manage Leave" description="Cuti / sakit / izin karyawan (user_leave) — sumber 'auto' = terdeteksi dari pesan WA." action={<AddLeaveSheet />} />
      {!leave ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : leave.length === 0 ? (
        <p className="text-muted-foreground">Belum ada catatan cuti. Tambah via <code>POST /leave</code>.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Jenis</TableHead>
                  <TableHead>Mulai</TableHead>
                  <TableHead>Selesai</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead>Sumber</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leave.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{nameById.get(l.am_id) ?? l.am_id}</TableCell>
                    <TableCell><Badge variant={jenisTone(l.jenis)}>{l.jenis}</Badge></TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{tgl(l.start_date)}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{tgl(l.end_date)}</TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">{l.keterangan ?? "—"}</TableCell>
                    <TableCell><Badge variant="outline">{l.source}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
