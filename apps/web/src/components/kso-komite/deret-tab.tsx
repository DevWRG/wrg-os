"use client";

// F170 Komite KSO — deretan tab layar (18 Nov 2026, evaluasi UI atas laporan user). Dulu sebelas tab dalam satu baris
// bergulir: tab di ujung tak terlihat, tab pertama terpotong, dan deretannya terbaca seperti teks biasa, bukan menu.
// Kini tab dikelompokkan (kelompokTab: Antrean · Daftar · Analisis), satu kelompok satu baris dengan label sejajar di
// kolom kiri (label hanya bila ada lebih dari satu kelompok), dan tiap tab berbingkai + ikon. Harus dipakai di dalam <Tabs>.

import {
  Calculator, CalendarDays, ChartPie, CircleAlert, ClipboardList, FileSignature, FileText, Gavel, History, Target,
  UserCheck, Wrench, Zap, type LucideIcon,
} from "lucide-react";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";

const IKON_TAB: Record<string, LucideIcon> = {
  saya: ClipboardList, hod: UserCheck, agenda: CalendarDays, direksi: Gavel, sekretariat: FileSignature, penawaran: FileText,
  teknik: Wrench, "belum-lengkap": CircleAlert, "lolos-tanpa-forum": Zap, riwayat: History, kpi: Target, bottomline: Calculator,
  portofolio: ChartPie,
};

export function DeretTab({ kelompok }: { kelompok: { judul: string; isi: { value: string; label: string }[] }[] }) {
  return (
    <TabsList className="h-auto w-full min-w-0 flex-col items-stretch justify-start gap-2 p-2 sm:w-auto sm:flex-1 group-data-[orientation=horizontal]/tabs:h-auto">
      {kelompok.map((k) => (
        <div key={k.judul} className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          {kelompok.length > 1 && (
            <span aria-hidden className="text-muted-foreground shrink-0 px-1 text-[11px] font-semibold tracking-wide uppercase sm:w-20">{k.judul}</span>
          )}
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {k.isi.map((t) => {
              const Ikon = IKON_TAB[t.value];
              return (
                <TabsTrigger key={t.value} value={t.value}
                  className="bg-background border-border text-foreground/75 h-8 flex-none gap-1.5 px-3 hover:not-data-active:border-primary/40 hover:not-data-active:bg-primary/5 data-active:font-semibold">
                  {Ikon && <Ikon aria-hidden className="size-4" />}{t.label}
                </TabsTrigger>
              );
            })}
          </div>
        </div>
      ))}
    </TabsList>
  );
}
