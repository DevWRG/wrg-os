"use client";

import { useRouter, usePathname } from "next/navigation";

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

import { periodeLabel } from "./insentif-format";

// Pemilih periode BULANAN untuk halaman Insentif. Ubah pilihan → update ?periode=YYYY-MM
// → server component re-fetch (halaman force-dynamic). Pola sama dengan NpkPeriodPicker.
//
// Kenapa bulanan, bukan semester seperti NPK: unit hitung model console_v2 adalah
// per transaksi yang direkap PER BULAN (insentif_bulanan). NPK yang per semester.
// Dua menu bersebelahan dengan granularitas berbeda, dan itu memang begitu.
//
// Batas bawah 2026-05: SK berlaku 1 Mei 2026, sebelum itu tak ada periode yang sah.
const AWAL = "2026-05";

export function InsentifPeriodePicker({ periode }: { periode: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const now = new Date();
  const nowP = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const batasAtas = periode > nowP ? periode : nowP;

  const opsi: string[] = [];
  let [y, m] = batasAtas.split("-").map(Number);
  for (let i = 0; i < 36; i++) {
    const p = `${y}-${String(m).padStart(2, "0")}`;
    if (p < AWAL) break;
    opsi.push(p);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  // Periode di luar rentang (mis. dari URL yang diketik) tetap ditampilkan supaya
  // Select tidak kosong dan pengguna bisa melihat apa yang sedang dibuka.
  if (!opsi.includes(periode)) opsi.unshift(periode);

  return (
    <Select value={periode} onValueChange={(v) => router.push(`${pathname}?periode=${v}`)}>
      <SelectTrigger size="sm" className="w-[168px] bg-card border-border" aria-label="Periode">
        <SelectValue>{(v) => periodeLabel(String(v))}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opsi.map((p) => (
          <SelectItem key={p} value={p}>{periodeLabel(p)}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
