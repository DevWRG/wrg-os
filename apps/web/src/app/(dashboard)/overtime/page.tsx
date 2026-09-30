import { PageHeader } from "@/components/dashboard/page-header";
import { OvertimeBoard } from "@/components/overtime/overtime-board";
import { sessionUser } from "@/lib/admin-guard";
import { canViewOvertime, isOvertimeAdmin } from "@/lib/overtime-access";

export const dynamic = "force-dynamic";

export default async function OvertimePage() {
  const u = await sessionUser();
  if (!canViewOvertime(u)) {
    return (
      <>
        <PageHeader title="Lembur" />
        <p className="text-muted-foreground mt-4 text-sm">
          Kamu belum diberi izin untuk halaman ini. Minta admin mencentang fitur &quot;overtime&quot; di Akses Grup.
        </p>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="Lembur (#OVERTIME)"
        description="Pengajuan jam lembur dari WA, disetujui HoD divisi pengaju. Rekap ini dipakai HR."
      />
      <OvertimeBoard isAdmin={isOvertimeAdmin(u)} />
    </>
  );
}
