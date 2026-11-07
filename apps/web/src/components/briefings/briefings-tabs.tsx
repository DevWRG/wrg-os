"use client";

import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_A10 = "a10";
const TAB_SENIN = "senin";
const TAB_MINGGUAN = "mingguan";

// Tab disimpan di URL (?tab=senin / ?tab=mingguan) karena WA Senin Brief & Briefing Mingguan
// ke Direktur menautkan langsung ke tab ini. A10 tetap default supaya tautan /briefings lama
// tak berubah.
export function BriefingsTabs({ a10, senin, mingguan }: { a10: ReactNode; senin: ReactNode; mingguan: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const t = params.get("tab");
  const tab = t === TAB_SENIN ? TAB_SENIN : t === TAB_MINGGUAN ? TAB_MINGGUAN : TAB_A10;
  const pindah = useCallback((v: string) => {
    const q = new URLSearchParams(params.toString());
    if (v === TAB_A10) q.delete("tab"); else q.set("tab", v);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  return (
    <Tabs value={tab} onValueChange={(v) => pindah(String(v))} className="gap-4">
      <TabsList>
        <TabsTrigger value={TAB_A10}>Briefing Eksekutif (A10)</TabsTrigger>
        <TabsTrigger value={TAB_SENIN}>Senin Brief</TabsTrigger>
        <TabsTrigger value={TAB_MINGGUAN}>Briefing Mingguan</TabsTrigger>
      </TabsList>
      <TabsContent value={TAB_A10}>{a10}</TabsContent>
      <TabsContent value={TAB_SENIN}>{senin}</TabsContent>
      <TabsContent value={TAB_MINGGUAN}>{mingguan}</TabsContent>
    </Tabs>
  );
}
