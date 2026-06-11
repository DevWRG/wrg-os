"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Pin, Star } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Reminder {
  d: string;
  am_id: string;
  name: string;
  cabang: string | null;
  note: string;
}
interface CalendarData {
  holidays: { tanggal: string; keterangan: string }[];
  ams: { am_id: string; name: string; cabang: string | null }[];
  reminders: Reminder[];
}

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const DOW = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfWeek = (d: Date) => {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
};

type View = "month" | "week";

export default function CalendarPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date());
  const [amFilter, setAmFilter] = useState("");
  const [cabFilter, setCabFilter] = useState("");
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);

  const range = useMemo(() => {
    if (view === "month") {
      const first = startOfMonth(cursor);
      const gridStart = startOfWeek(first);
      const gridEnd = new Date(gridStart);
      gridEnd.setDate(gridEnd.getDate() + 41); // 6 minggu
      return { display: first, gridStart, gridEnd, cells: 42 };
    }
    const gridStart = startOfWeek(cursor);
    const gridEnd = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + 6);
    return { display: gridStart, gridStart, gridEnd, cells: 7 };
  }, [view, cursor]);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ from: fmt(range.gridStart), to: fmt(range.gridEnd) });
    if (amFilter) qs.set("am_id", amFilter);
    if (cabFilter) qs.set("cabang", cabFilter);
    try {
      const r = await fetch(`/api/report/calendar?${qs}`, { cache: "no-store" });
      setData(r.ok ? await r.json() : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range.gridStart, range.gridEnd, amFilter, cabFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load() men-setState (loading) saat fetch; disengaja.
    void load();
  }, [load]);

  // Katalog cabang (dari ams), independen dari filter aktif
  const cabangs = useMemo(
    () => [...new Set((data?.ams ?? []).map((a) => a.cabang).filter(Boolean) as string[])].sort(),
    [data?.ams],
  );

  const holByDate = useMemo(() => {
    const m: Record<string, string> = {};
    (data?.holidays ?? []).forEach((h) => (m[h.tanggal] = h.keterangan));
    return m;
  }, [data?.holidays]);


  const remByDate = useMemo(() => {
    const m: Record<string, Reminder[]> = {};
    (data?.reminders ?? []).forEach((r) => (m[r.d] = m[r.d] || []).push(r));
    return m;
  }, [data?.reminders]);

  const title =
    view === "month"
      ? `${MONTHS[range.display.getMonth()]} ${range.display.getFullYear()}`
      : `${range.gridStart.getDate()} ${MONTHS[range.gridStart.getMonth()].slice(0, 3)} – ${range.gridEnd.getDate()} ${MONTHS[range.gridEnd.getMonth()].slice(0, 3)} ${range.gridEnd.getFullYear()}`;

  const nav = (dir: -1 | 0 | 1) => {
    if (dir === 0) return setCursor(new Date());
    setCursor((c) => {
      const n = new Date(c);
      if (view === "month") n.setMonth(n.getMonth() + dir);
      else n.setDate(n.getDate() + dir * 7);
      return n;
    });
  };

  const today = fmt(new Date());

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wider uppercase">Sales</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Sales <span className="text-primary">Calendar</span>
          </h1>
          <p className="text-muted-foreground text-sm">Libur nasional + catatan reminder Account Manager. Klik tanggal untuk detail hari itu.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={amFilter}
            onChange={(e) => setAmFilter(e.target.value)}
            className="border-input bg-card h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
          >
            <option value="">Semua AM</option>
            {(data?.ams ?? []).map((a) => (
              <option key={a.am_id} value={a.am_id}>{a.name}{a.cabang ? ` (${a.cabang})` : ""}</option>
            ))}
          </select>
          <select
            value={cabFilter}
            onChange={(e) => setCabFilter(e.target.value)}
            className="border-input bg-card h-9 rounded-md border px-2.5 text-sm outline-none focus-visible:border-primary"
          >
            <option value="">Semua cabang</option>
            {cabangs.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-card rounded-2xl border shadow-[var(--shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-lg font-semibold tabular-nums">{title}</h2>
          <div className="flex items-center gap-2">
            <div className="bg-muted inline-flex rounded-md p-0.5">
              {(["month", "week"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded px-3 py-1 text-sm font-medium capitalize transition-colors",
                    view === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "month" ? "Bulan" : "Minggu"}
                </button>
              ))}
            </div>
            <Button variant="outline" size="icon-sm" aria-label="Sebelumnya" onClick={() => nav(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => nav(0)}>Hari ini</Button>
            <Button variant="outline" size="icon-sm" aria-label="Berikutnya" onClick={() => nav(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b text-center">
          {DOW.map((d) => (
            <div key={d} className="text-muted-foreground py-2 text-[11px] font-semibold tracking-wider uppercase">{d}</div>
          ))}
        </div>

        <div className={cn("grid grid-cols-7", loading && "opacity-50")}>
          {Array.from({ length: range.cells }).map((_, i) => {
            const d = new Date(range.gridStart);
            d.setDate(d.getDate() + i);
            const ds = fmt(d);
            const outside = view === "month" && d.getMonth() !== range.display.getMonth();
            const isToday = ds === today;
            const isWknd = d.getDay() === 0 || d.getDay() === 6;
            const holiday = holByDate[ds];
            const dayReminders = remByDate[ds] ?? [];

            return (
              <button
                key={ds}
                type="button"
                onClick={() => router.push(`/calendar/${ds}`)}
                className={cn(
                  "flex min-h-28 flex-col items-stretch gap-1 border-r border-b p-1.5 text-left align-top transition-colors last:border-r-0 hover:bg-muted/60",
                  view === "week" && "min-h-72",
                  outside && "bg-muted/30 text-muted-foreground",
                  isToday && "bg-warning-soft",
                  !isToday && isWknd && !holiday && "bg-muted/20",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-6 items-center justify-center self-start rounded-full text-xs font-semibold tabular-nums",
                    isToday && "bg-danger text-danger-foreground",
                  )}
                >
                  {d.getDate()}
                </span>
                {holiday && (
                  <span className="bg-purple/10 text-purple flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium" title={holiday}>
                    <Star className="size-2.5 shrink-0" /> <span className="truncate">{holiday}</span>
                  </span>
                )}
                {dayReminders.slice(0, 2).map((r, idx) => (
                  <span
                    key={`rem-${r.am_id}-${idx}`}
                    className="bg-danger-soft text-danger flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[10px] font-medium"
                    title={`📌 ${r.name}${r.cabang ? ` (${r.cabang})` : ""}: ${r.note}`}
                  >
                    <Pin className="size-2.5 shrink-0" /> <span className="truncate">{r.name}: {r.note}</span>
                  </span>
                ))}
                {dayReminders.length > 2 && (
                  <span className="text-danger px-1.5 text-[10px] font-medium">+{dayReminders.length - 2} reminder</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
