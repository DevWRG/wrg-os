"use client";

// Bilah tab untuk halaman hasil peleburan menu. Tab disimpan di URL (?tab=), bukan
// useState: tautan & bookmark tetap menunjuk tab yang sama, dan URL menu lama cukup
// di-redirect ke `?tab=`. Isi tab dirender SERVER (page.tsx) — komponen ini hanya
// memindah ?tab= lewat router.replace (bukan push: berganti tab tak layak menumpuk
// di riwayat; scroll:false supaya posisi baca tak melompat). Pola visual sama
// dengan Produktivitas KSO: bilah tab di kartunya sendiri.

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DefTab } from "@/lib/page-tabs";

export function PageTabs({ tabs, aktif }: { tabs: readonly DefTab[]; aktif: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const pindah = useCallback((v: string) => {
    // Filter/halaman milik satu tab (q, status, page, …) tak berlaku di tab lain —
    // tiap tab dulunya halaman sendiri. Berganti tab = mulai bersih.
    const q = new URLSearchParams();
    if (v !== tabs[0]?.key) q.set("tab", v);
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [pathname, router, tabs]);

  // Satu tab saja (user hanya berizin ke satu bagian) → tak perlu bilah tab.
  if (tabs.length < 2) return null;

  return (
    <Tabs value={aktif} onValueChange={(v) => pindah(String(v))}>
      <Card className="py-0">
        <CardContent className="overflow-x-auto px-3 py-2.5">
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </CardContent>
      </Card>
    </Tabs>
  );
}
