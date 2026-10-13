"use client";

// F169 — bagian bersama riwayat penempatan alat: tipe baris + satu baris riwayat.
// Dipakai dialog Produktivitas KSO (baca-saja) dan dialog Pindah/tarik di Daftar Alat.

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { num } from "./produktivitas-shared";

export interface Penempatan {
  id: number; assetId: number; snKey: string; snRaw: string | null;
  typeAlat: string | null; namaAlat: string | null; skema: string;
  accountId: number | null; faskes: string | null; customerRaw: string;
  mulai: string | null; selesai: string | null; terbuka: boolean;
  sumber: string; catatan: string | null; dicatatOleh: string; dicatatAt: string;
  tes: number | null; bulanLapor: number;
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
// Diurai dari string, bukan lewat Date: kolom date + Date() bergeser ke UTC di WIB.
export const tglPendek = (s: string | null) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};

const SUMBER: Record<string, string> = {
  awal: "lokasi saat riwayat mulai dicatat",
  sheet: "impor sheet Populasi Alat",
  manual: "dicatat teknisi",
  sistem: "otomatis",
};

export function BarisPenempatan({ p, sorot, aksi }: { p: Penempatan; sorot: boolean; aksi?: ReactNode }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]", !sorot && "text-muted-foreground")}>
      <span className="tabular-nums">
        {tglPendek(p.mulai) ?? "awal tercatat"} <ArrowRight className="inline size-3" /> {tglPendek(p.selesai) ?? "sekarang"}
      </span>
      <span className={cn(sorot && "text-foreground font-medium")}>{p.faskes ?? p.customerRaw}</span>
      {p.accountId === null && !/^\s*stok\s+kantor/i.test(p.customerRaw) ? (
        <span className="text-amber-600">(belum terpeta ke customer Accurate)</span>
      ) : null}
      <span className="tabular-nums">
        {p.tes === null ? "tanpa laporan tes" : `${num(p.tes)} tes · ${p.bulanLapor} bln`}
      </span>
      <span title={[SUMBER[p.sumber] ?? p.sumber, p.catatan, `oleh ${p.dicatatOleh}`].filter(Boolean).join(" — ")}
        className="text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">
        {SUMBER[p.sumber] ?? p.sumber}
      </span>
      {aksi}
    </li>
  );
}
