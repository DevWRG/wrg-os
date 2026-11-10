"use client";

import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_KAPASITAS = "kapasitas";
const TAB_JADWAL = "jadwal";
const TAB_LAPORAN = "laporan";

// Tab disimpan di URL (?tab=jadwal / ?tab=laporan) supaya bisa ditautkan langsung
// dan tetap di tab yang sama setelah refresh. Kapasitas = default, jadi tautan
// /readiness-board lama tak berubah.
export function ReadinessBoardTabs({
  kapasitas,
  jadwal,
  laporan,
  jumlah,
}: {
  kapasitas: ReactNode;
  jadwal: ReactNode;
  laporan: ReactNode;
  jumlah: { kapasitas: number | null; jadwal: number | null; laporan: number | null };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("tab");
  const tab = t === TAB_JADWAL ? TAB_JADWAL : t === TAB_LAPORAN ? TAB_LAPORAN : TAB_KAPASITAS;
  const pindah = useCallback((v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v === TAB_KAPASITAS) q.delete("tab"); else q.set("tab", v);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);
  const label = (teks: string, n: number | null) => (n == null ? teks : `${teks} (${n})`);

  return (
    <Tabs value={tab} onValueChange={(v) => pindah(String(v))} className="gap-4">
      {/* Layar sempit (375px): tiga label tak muat → geser horizontal, bukan melebarkan halaman. */}
      <TabsList className="max-w-full justify-start overflow-x-auto">
        <TabsTrigger value={TAB_KAPASITAS}>{label("Kapasitas Teknisi", jumlah.kapasitas)}</TabsTrigger>
        <TabsTrigger value={TAB_JADWAL}>{label("Install Schedule", jumlah.jadwal)}</TabsTrigger>
        <TabsTrigger value={TAB_LAPORAN}>{label("Laporan Terbaru", jumlah.laporan)}</TabsTrigger>
      </TabsList>
      <TabsContent value={TAB_KAPASITAS}>{kapasitas}</TabsContent>
      <TabsContent value={TAB_JADWAL}>{jadwal}</TabsContent>
      <TabsContent value={TAB_LAPORAN}>{laporan}</TabsContent>
    </Tabs>
  );
}
