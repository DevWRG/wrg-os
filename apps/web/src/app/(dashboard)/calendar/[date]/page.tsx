import Link from "next/link";
import { ChevronLeft, MapPin, Pin, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { gatewayFetch } from "@/lib/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

interface PlanDetail {
  customer_name: string | null;
  tujuan: string | null;
  goal: string | null;
  reported: boolean;
  is_late_plan: boolean;
  geo: boolean;
  hasil: string | null;
  next_action: string | null;
}
interface AmDay {
  am_id: string;
  name: string;
  cabang: string | null;
  total: number;
  reported: number;
  geo: number;
  late: boolean;
  plans: PlanDetail[];
}
interface DayData {
  date: string;
  holiday: string | null;
  reminders: { am_id: string; name: string; cabang: string | null; note: string }[];
  ams: AmDay[];
}

const DOW = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(y, m - 1, d);
  return `${DOW[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}

function statusBadge(am: AmDay) {
  const [cls, label] =
    am.reported === am.total ? ["bg-success-soft text-success", "Lengkap"]
    : am.reported > 0 ? ["bg-warning-soft text-warning", "Sebagian"]
    : am.late ? ["bg-danger-soft text-danger", "Telat"]
    : ["bg-muted text-muted-foreground", "Belum"];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export default async function CalendarDayPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  let data: DayData | null = null;
  try {
    const res = await gatewayFetch(`/report/calendar/day?date=${date}`);
    if (res.ok) data = await res.json();
  } catch {
    data = null;
  }
  const ams = data?.ams ?? [];
  const reminders = data?.reminders ?? [];
  const totalPlan = ams.reduce((s, a) => s + a.total, 0);
  const totalReported = ams.reduce((s, a) => s + a.reported, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/calendar" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" /> Kembali ke kalender
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{prettyDate(date)}</h1>
        <p className="text-muted-foreground text-sm">
          {ams.length} AM · {totalReported}/{totalPlan} kunjungan ter-report
        </p>
        {data?.holiday && (
          <p className="text-purple bg-purple/10 mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium">
            <Star className="size-4" /> Libur nasional: {data.holiday}
          </p>
        )}
      </div>

      {reminders.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Catatan Reminder</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reminders.map((r, i) => (
              <div key={`${r.am_id}-${i}`} className="border-danger/30 bg-danger-soft text-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
                <Pin className="mt-0.5 size-4 shrink-0" />
                <span><b>{r.name}</b>{r.cabang ? ` (${r.cabang})` : ""}: {r.note}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {ams.length === 0 ? (
        <Card>
          <CardContent className="py-2">
            <EmptyState title="Tidak ada plan" description="Tak ada AM yang punya plan kunjungan di tanggal ini." />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {ams.map((am) => (
            <Card key={am.am_id}>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <div>
                  <CardTitle className="text-base font-semibold">{am.name}</CardTitle>
                  <p className="text-muted-foreground text-xs">{am.cabang ?? "—"}</p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  {am.geo > 0 && (
                    <span className="text-success inline-flex items-center gap-1"><MapPin className="size-3.5" />{am.geo}</span>
                  )}
                  <span className="text-muted-foreground tabular-nums">{am.reported}/{am.total}</span>
                  {statusBadge(am)}
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {am.plans.map((p, i) => {
                  const tone = p.reported ? "border-l-success" : p.is_late_plan ? "border-l-danger" : "border-l-border";
                  return (
                    <div key={i} className={cn("rounded-md border border-l-4 bg-muted/30 px-3 py-2", tone)}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{p.customer_name ?? "—"}</span>
                        <span className="flex items-center gap-1.5">
                          {p.geo && <MapPin className="text-success size-3.5" />}
                          {p.is_late_plan && <span className="bg-danger-soft text-danger rounded px-1.5 py-0.5 text-[10px] font-medium">telat</span>}
                          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", p.reported ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>
                            {p.reported ? "reported" : "belum"}
                          </span>
                        </span>
                      </div>
                      {(p.tujuan || p.goal) && (
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {[p.tujuan, p.goal].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {p.hasil && <p className="mt-1.5 text-sm">{p.hasil}</p>}
                      {p.next_action && (
                        <p className="text-muted-foreground mt-1 text-xs">→ {p.next_action}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
