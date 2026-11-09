"use client";

import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PusatPanel } from "./pusat-panel";
import { StationPanel } from "./station-panel";
import { useKasData } from "./use-kas-data";
import type { IzinKasStation } from "./types";

// F33 — dua peran, dua layar: Station (kas cabang mencatat & mengajukan) dan Pusat (meninjau,
// memutuskan, merealisasi). Pemegang kedua izin (mis. admin) mendapat tab; selainnya langsung
// melihat layarnya sendiri tanpa tab.
type Mode = "station" | "pusat";

export function KasStationView({ izin }: { izin: IzinKasStation }) {
  const bisaStation = izin.stationView;
  const bisaPusat = izin.reviewView;
  const [mode, setMode] = useState<Mode>(bisaPusat ? "pusat" : "station");
  const { data, galat, loading } = useKasData<{ cabang: string[] }>("cabang");
  const cabangOpsi = data?.cabang ?? [];

  if (galat) return <EmptyState title="Data tidak dapat dimuat" description={galat} />;
  if (loading && !data) return <p className="text-muted-foreground text-sm">Memuat…</p>;

  if (bisaStation && bisaPusat) {
    return (
      <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-4">
        <TabsList>
          <TabsTrigger value="pusat">Pusat — tinjau &amp; realisasi</TabsTrigger>
          <TabsTrigger value="station">Station — catat kas</TabsTrigger>
        </TabsList>
        <TabsContent value="pusat"><PusatPanel izin={izin} cabangOpsi={cabangOpsi} /></TabsContent>
        <TabsContent value="station"><StationPanel izin={izin} cabangOpsi={cabangOpsi} /></TabsContent>
      </Tabs>
    );
  }
  return bisaPusat ? <PusatPanel izin={izin} cabangOpsi={cabangOpsi} /> : <StationPanel izin={izin} cabangOpsi={cabangOpsi} />;
}
