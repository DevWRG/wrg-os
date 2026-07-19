"use client";

import { useRouter, usePathname } from "next/navigation";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Pemilih Tahun + Semester untuk halaman NPK. Ubah pilihan → update query param
// (?year=&period=) → server component re-fetch (halaman force-dynamic). Dipakai di
// /npk (Direktur) & /npk/self (HoD). Tahun mulai 2026 (awal fitur) s/d tahun berjalan.
export function NpkPeriodPicker({ year, period }: { year: number; period: "S1" | "S2" }) {
  const router = useRouter();
  const pathname = usePathname();

  const nowY = new Date().getFullYear();
  const maxY = Math.max(nowY, year);
  const years: number[] = [];
  for (let y = maxY; y >= 2026; y--) years.push(y);
  if (!years.includes(year)) years.unshift(year);

  const go = (y: number, p: "S1" | "S2") => router.push(`${pathname}?year=${y}&period=${p}`);

  return (
    <div className="flex items-center gap-2">
      <Select value={String(year)} onValueChange={(v) => go(Number(v), period)}>
        <SelectTrigger size="sm" className="w-[92px] bg-card border-border" aria-label="Tahun">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={period} onValueChange={(v) => go(year, v as "S1" | "S2")}>
        <SelectTrigger size="sm" className="w-[132px] bg-card border-border" aria-label="Semester">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="S1">Semester 1</SelectItem>
          <SelectItem value="S2">Semester 2</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
