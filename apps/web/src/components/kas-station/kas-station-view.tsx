"use client";

import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { HarianTab } from "./harian-tab";
import { RekapTab } from "./rekap-tab";
import { useKasData } from "./use-kas-data";
import type { IzinKasStation } from "./types";

type Tab = "harian" | "rekap";

export function KasStationView({ izin }: { izin: IzinKasStation }) {
  const [tab, setTab] = useState<Tab>(izin.stationView ? "harian" : "rekap");
  const { data, galat, loading } = useKasData<{ cabang: string[] }>("cabang");
  const cabangOpsi = data?.cabang ?? [];
  const chip = (t: Tab) =>
    cn("rounded-md border px-3 py-1.5 text-sm", tab === t ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent");

  if (galat) return <EmptyState title="Data tidak dapat dimuat" description={galat} />;
  if (loading && !data) return <p className="text-muted-foreground text-sm">Memuat…</p>;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {izin.stationView && <button type="button" className={chip("harian")} onClick={() => setTab("harian")}>Kas Harian</button>}
        <button type="button" className={chip("rekap")} onClick={() => setTab("rekap")}>Rekap Mingguan</button>
      </div>
      {tab === "harian" && izin.stationView ? <HarianTab izin={izin} cabangOpsi={cabangOpsi} /> : <RekapTab izin={izin} cabangOpsi={cabangOpsi} />}
    </div>
  );
}
