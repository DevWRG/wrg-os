import Link from "next/link";
import { ChevronLeft, MapPin, Star } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AmRow {
  am_id: string;
  name: string;
  cabang: string | null;
  total: number;
  reported: number;
  geo: number;
  late: boolean;
}
interface CalendarData {
  holidays: { tanggal: string; keterangan: string }[];
  rows: AmRow[];
}

const DOW = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return `${DOW[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function statusBadge(am: AmRow) {
  const cls =
    am.reported === am.total ? "bg-success-soft text-success"
    : am.reported > 0 ? "bg-warning-soft text-warning"
    : am.late ? "bg-danger-soft text-danger"
    : "bg-muted text-muted-foreground";
  const label =
    am.reported === am.total ? "Lengkap"
    : am.reported > 0 ? "Sebagian"
    : am.late ? "Telat" : "Belum";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export default async function CalendarDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  let data: CalendarData | null = null;
  try {
    const res = await gatewayFetch(`/report/calendar?from=${date}&to=${date}`);
    if (res.ok) data = await res.json();
  } catch {
    data = null;
  }
  const rows = (data?.rows ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const holiday = data?.holidays?.[0]?.keterangan;
  const totalPlan = rows.reduce((s, r) => s + r.total, 0);
  const totalReported = rows.reduce((s, r) => s + r.reported, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/calendar" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" /> Kembali ke kalender
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{prettyDate(date)}</h1>
        <p className="text-muted-foreground text-sm">
          {rows.length} AM · {totalReported}/{totalPlan} kunjungan ter-report
        </p>
        {holiday && (
          <p className="text-purple bg-purple/10 mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium">
            <Star className="size-4" /> Libur nasional: {holiday}
          </p>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Plan &amp; Report per AM</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <EmptyState title="Tidak ada plan" description="Tak ada AM yang punya plan kunjungan di tanggal ini." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account Manager</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead className="text-right">Reported</TableHead>
                  <TableHead className="text-right">Geotag</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((am) => (
                  <TableRow key={am.am_id}>
                    <TableCell className="font-medium">{am.name}</TableCell>
                    <TableCell className="text-muted-foreground">{am.cabang ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{am.reported}/{am.total}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {am.geo > 0 ? (
                        <span className="text-success inline-flex items-center gap-1"><MapPin className="size-3.5" />{am.geo}</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell>{statusBadge(am)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
