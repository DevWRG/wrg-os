"use client";

import { useCallback, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TAB_A10 = "a10";
const TAB_SENIN = "senin";

// Tab disimpan di URL (?tab=senin) karena WA Senin Brief ke Direktur menautkan
// langsung ke tab ini. A10 tetap default supaya tautan /briefings lama tak berubah.
export function BriefingsTabs({ a10, senin }: { a10: ReactNode; senin: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === TAB_SENIN ? TAB_SENIN : TAB_A10;
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
      </TabsList>
      <TabsContent value={TAB_A10}>{a10}</TabsContent>
      <TabsContent value={TAB_SENIN}>{senin}</TabsContent>
    </Tabs>
  );
}
