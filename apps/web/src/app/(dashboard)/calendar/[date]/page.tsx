import Link from "next/link";
import { ChevronLeft, Pin, Repeat, Star } from "lucide-react";

import { gatewayFetch } from "@/lib/gateway";
import { sessionUser } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface DayData {
  date: string;
  holiday: string | null;
  reminders: { am_id: string; name: string; cabang: string | null; note: string }[];
  leave?: {
    am_id: string;
    name: string;
    cabang: string | null;
    jenis: string;
    start_date: string;
    end_date: string;
    backup_am_id: string | null;
    backup_name: string | null;
  }[];
}

const DOW = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return `${DOW[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

export default async function CalendarDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  // x-user-id → backend scope row-level: AM hanya melihat reminder-nya sendiri.
  const me = await sessionUser();
  let data: DayData | null = null;
  try {
    const res = await gatewayFetch(`/report/calendar/day?date=${date}`, me ? { headers: { "x-user-id": me.id } } : undefined);
    if (res.ok) data = await res.json();
  } catch {
    data = null;
  }
  const reminders = data?.reminders ?? [];
  const holiday = data?.holiday ?? null;
  const leave = data?.leave ?? [];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/calendar" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" /> Kembali ke kalender
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{prettyDate(date)}</h1>
        <p className="text-muted-foreground text-sm">Libur nasional, yang tidak masuk (+ penggantinya) &amp; catatan reminder pada tanggal ini.</p>
      </div>

      {holiday && (
        <Card>
          <CardContent className="py-4">
            <p className="text-purple bg-purple/10 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium">
              <Star className="size-4" /> Libur nasional: {holiday}
            </p>
          </CardContent>
        </Card>
      )}

      {leave.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Tidak Masuk &amp; Backup PIC ({leave.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {leave.map((l) => (
              <div key={`${l.am_id}-${l.start_date}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm">
                <span><b>{l.name}</b>{l.cabang ? ` (${l.cabang})` : ""}</span>
                <span className="text-muted-foreground">
                  {l.jenis} {l.start_date === l.end_date ? "" : `s/d ${l.end_date}`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Repeat className="text-muted-foreground size-3.5" />
                  {l.backup_name ? <>ke <b>{l.backup_name}</b></> : <span className="text-muted-foreground">belum ada pengganti</span>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Catatan Reminder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reminders.length === 0 ? (
            <EmptyState title="Tidak ada reminder" description="Tak ada catatan reminder AM untuk tanggal ini." />
          ) : (
            reminders.map((r, i) => (
              <div key={`${r.am_id}-${i}`} className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                <Pin className="mt-0.5 size-4 shrink-0" />
                <span><b>{r.name}</b>{r.cabang ? ` (${r.cabang})` : ""}: {r.note}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
