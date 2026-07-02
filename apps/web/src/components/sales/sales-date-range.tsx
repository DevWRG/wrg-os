"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Form date-range Sales Performance → navigasi /sales?tab=…&from=…&to=… (server
// component re-fetch dgn rentang baru). Tab dipertahankan.
export function SalesDateRange({ tab, from, to }: { tab: string; from: string; to: string }) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  // useTransition: isPending nyala selama re-fetch RSC dan otomatis mati saat
  // konten server baru selesai commit — jadi spinner tidak macet (bug: dulu
  // setLoading(true) tanpa pernah setLoading(false) setelah soft navigation).
  const [pending, startTransition] = useTransition();

  function apply() {
    const qs = new URLSearchParams({ tab });
    if (f) qs.set("from", f);
    if (t) qs.set("to", t);
    startTransition(() => router.push(`/sales?${qs.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label htmlFor="sales-from" className="text-muted-foreground text-xs">Dari</Label>
      <Input id="sales-from" type="date" value={f} onChange={(e) => setF(e.target.value)} className="bg-card h-8 w-auto" />
      <Label htmlFor="sales-to" className="text-muted-foreground text-xs">Sampai</Label>
      <Input id="sales-to" type="date" value={t} onChange={(e) => setT(e.target.value)} className="bg-card h-8 w-auto" />
      <Button size="sm" onClick={apply} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : null} Terapkan
      </Button>
    </div>
  );
}
