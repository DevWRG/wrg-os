import { apiBaseUrl } from "@/lib/gateway";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader title="Holidays" description="Hari libur nasional (master_holiday) — dipakai menghitung hari kerja & mengecualikan dari reminder." />
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {holidays.map((h) => (
                  <TableRow key={h.tanggal}>
                    <TableCell className="font-medium whitespace-nowrap">{tgl(h.tanggal)}</TableCell>
                    <TableCell>{h.keterangan}</TableCell>
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
