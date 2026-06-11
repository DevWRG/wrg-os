import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
import { AddHolidaySheet } from "@/components/crm/add-holiday-sheet";
import { HolidayRowActions } from "@/components/crm/holiday-row-actions";
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

interface Holiday {
  id: string;
  tanggal: string;
  keterangan: string;
}

const tgl = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("id-ID", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
};

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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Keterangan</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell className="font-medium whitespace-nowrap">{tgl(h.tanggal)}</TableCell>
                    <TableCell>{h.keterangan}</TableCell>
                    <TableCell><HolidayRowActions id={h.id} tanggal={h.tanggal} keterangan={h.keterangan} /></TableCell>
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
