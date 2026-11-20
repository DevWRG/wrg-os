"use client";

// Kontrol periode bersama menu Kinerja Produk (tab Scorecard & Revenue per Lini):
// preset (Tahun ini, Kuartal ini, Kuartal lalu, Bulan lalu, 12 bulan) + tanggal
// Dari–s/d. Dulu tab Revenue per Lini memakai dropdown bulan sendiri — dua tab di satu
// menu dengan dua cara memilih periode (permintaan user 20 Nov 2026: samakan).

import { Card, CardContent } from "@/components/ui/card";

export interface Rentang { from: string; to: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Tanggal "hari ini" WIB (UTC+7), supaya preset tak bergeser lewat tengah malam UTC.
export function presetRentang(k: string): Rentang {
  const now = new Date(Date.now() + 7 * 3600_000);
  const y = now.getUTCFullYear(), m = now.getUTCMonth();
  if (k === "bulan-ini") return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(now) };
  if (k === "bulan-lalu") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) };
  if (k === "kuartal") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q, 1))), to: iso(now) }; }
  if (k === "kuartal-lalu") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q - 3, 1))), to: iso(new Date(Date.UTC(y, q, 0))) }; }
  if (k === "12-bulan") return { from: iso(new Date(Date.UTC(y, m - 11, 1))), to: iso(now) };
  return { from: `${y}-01-01`, to: iso(now) }; // ytd
}

const PRESET = [["ytd", "Tahun ini"], ["kuartal", "Kuartal ini"], ["kuartal-lalu", "Kuartal lalu"], ["bulan-ini", "Bulan ini"], ["bulan-lalu", "Bulan lalu"], ["12-bulan", "12 bulan"]] as const;

export function RentangPeriode({ rentang, onGanti, memuat = false, galat }: {
  rentang: Rentang;
  onGanti: (r: Rentang) => void;
  memuat?: boolean;
  galat?: string | null;
}) {
  const ganti = (r: Rentang) => { if (r.from && r.to && r.from <= r.to) onGanti(r); };
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        {PRESET.map(([k, l]) => (
          <button key={k} type="button" disabled={memuat} onClick={() => ganti(presetRentang(k))}
            className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">{l}</button>
        ))}
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">Dari
          <input type="date" value={rentang.from} disabled={memuat} onChange={(e) => ganti({ ...rentang, from: e.target.value })}
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs" />
        </label>
        <label className="text-muted-foreground flex items-center gap-1.5 text-xs">s/d
          <input type="date" value={rentang.to} disabled={memuat} onChange={(e) => ganti({ ...rentang, to: e.target.value })}
            className="border-input bg-background text-foreground rounded-md border px-2 py-1 text-xs" />
        </label>
        {memuat && <span className="text-muted-foreground text-xs">Memuat…</span>}
        {galat && <span className="text-xs text-rose-700 dark:text-rose-400">{galat}</span>}
      </CardContent>
    </Card>
  );
}
