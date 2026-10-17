"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { KalenderView } from "./kalender-view";
import { TrackerView } from "./tracker-view";
import type { TukarFakturHasil } from "./types";

type Tab = "tracker" | "kalender";

export function TukarFakturView({ data }: { data: TukarFakturHasil }) {
  const [tab, setTab] = useState<Tab>("tracker");
  const chip = (t: Tab) =>
    cn("rounded-md border px-3 py-1.5 text-sm", tab === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button type="button" className={chip("tracker")} onClick={() => setTab("tracker")}>Tracker Faktur</button>
        <button type="button" className={chip("kalender")} onClick={() => setTab("kalender")}>Klinik Calendar</button>
      </div>
      {tab === "tracker" ? <TrackerView data={data} /> : <KalenderView />}
    </div>
  );
}
