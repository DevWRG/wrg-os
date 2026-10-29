"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { WatchPointBoardView, type WatchBoard } from "@/components/watchpoint/watchpoint-board";
import { WatchPointWeeklyView } from "@/components/watchpoint/watchpoint-weekly";
import { RevenueAreaView } from "@/components/revenue-area/revenue-area-view";

// Dua sudut pandang papan WatchPoint yang sama:
//   Ringkasan — kondisi SEKARANG (dihitung live tiap buka halaman).
//   Weekly    — per minggu ISO + riwayat + deck PPT (format Weekly Report HoD).
// Tab Weekly di-mount hanya saat dipilih supaya halaman tak menarik data minggu
// yang tak dilihat.
//   Revenue Area — revenue netto per cabang/region vs periode lalu (F150 tahap 1).
type TabKey = "ringkasan" | "weekly" | "revenue-area";

const TABS: { key: TabKey; label: string }[] = [
  { key: "ringkasan", label: "Ringkasan HoD" },
  { key: "weekly", label: "Weekly (PPT)" },
  { key: "revenue-area", label: "Revenue Area" },
];

export function WatchPointTabs({ initial, canEdit = false }: { initial: WatchBoard | null; canEdit?: boolean }) {
  const [tab, setTab] = useState<TabKey>("ringkasan");

  return (
    <div className="space-y-5">
      <div className="border-border flex flex-wrap gap-1 border-b pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "ringkasan" ? (
        <WatchPointBoardView initial={initial} canEdit={canEdit} />
      ) : tab === "weekly" ? (
        <WatchPointWeeklyView />
      ) : (
        <RevenueAreaView endpoint="/api/watchpoint/revenue-area" />
      )}
    </div>
  );
}
