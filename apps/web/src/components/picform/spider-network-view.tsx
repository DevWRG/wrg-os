"use client";

import { useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KoordinasiView } from "./koordinasi-view";
import { KoordGraph } from "./spider/koord-graph";
import { WorkForce } from "./spider/work-force";
import type { KoordGraf, PohonPekerjaan } from "./spider/types";

// Tiga tab, tiga pertanyaan berbeda — bukan tiga selera tampilan:
//   • Pohon    — "posisi ini kerjanya apa saja?"  (struktur, dibaca menurun)
//   • Jaringan — "divisi ini bersinggungan dengan siapa?" (relasi, tak punya akar)
//   • Tabel    — "cari baris X" + padanan yang bisa dipindai/diurutkan untuk
//                kedua graf di atas. TIDAK dibuang saat visual D3 masuk: graf
//                bagus untuk melihat bentuk, payah untuk mencari satu baris,
//                dan ia satu-satunya jalan baca kalau warna/bentuk tak terbaca.
export function SpiderNetworkView({
  graf, pohon,
}: { graf: KoordGraf | null; pohon: PohonPekerjaan | null }) {
  const labelDivisi = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of pohon?.divisi ?? []) m[d.key] = d.label;
    return m;
  }, [pohon]);

  return (
    <Tabs defaultValue="pohon">
      <TabsList>
        <TabsTrigger value="pohon">Pohon Pekerjaan</TabsTrigger>
        <TabsTrigger value="jaringan">Jaringan Koordinasi</TabsTrigger>
        <TabsTrigger value="tabel">Tabel</TabsTrigger>
      </TabsList>

      <TabsContent value="pohon" className="pt-3">
        {pohon && pohon.ringkas.posisi > 0 ? (
          <WorkForce data={pohon} />
        ) : (
          <Kosong />
        )}
      </TabsContent>

      <TabsContent value="jaringan" className="pt-3">
        {graf && graf.ringkas.baris > 0 ? (
          <KoordGraph graf={graf} labelDivisi={labelDivisi} pohon={pohon} />
        ) : (
          <Kosong />
        )}
      </TabsContent>

      <TabsContent value="tabel" className="pt-3">
        <KoordinasiView graf={graf} />
      </TabsContent>
    </Tabs>
  );
}

function Kosong() {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-muted-foreground">
          Data form PIC tidak tersedia. Pastikan <code>apps/api</code> jalan dan datanya sudah
          diimpor (<code>scripts/ops/pic-form-import.mjs --apply</code>).
        </p>
      </CardContent>
    </Card>
  );
}
