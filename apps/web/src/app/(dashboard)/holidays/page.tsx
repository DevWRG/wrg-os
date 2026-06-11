import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddHolidaySheet } from "@/components/crm/add-holiday-sheet";
import { HolidaysTable } from "@/components/tables/holidays-table";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

interface Holiday {
  id: string;
  tanggal: string;
  keterangan: string;
}

async function getHolidays(): Promise<Holiday[] | null> {
  try {
    const res = await fetch(`${apiBaseUrl()}/holidays`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { holidays: Holiday[] }).holidays;
  } catch {
    return null;
  }
}

export default async function HolidaysPage() {
  const holidays = await getHolidays();

  return (
    <>
      <PageHeader title="Holidays" description="Hari libur nasional (master_holiday) — dipakai menghitung hari kerja & mengecualikan dari reminder." action={<AddHolidaySheet />} />
      {!holidays ? (
        <p className="text-muted-foreground">
          Data tidak tersedia. Pastikan <code>apps/api</code> jalan dengan <code>DATABASE_URL</code>.
        </p>
      ) : holidays.length === 0 ? (
        <p className="text-muted-foreground">Belum ada hari libur. Tambah via <code>POST /holidays</code>.</p>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <HolidaysTable holidays={holidays} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
