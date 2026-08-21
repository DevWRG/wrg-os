"use client";

// Potongan UI yang dipakai semua kategori Simulator KSO.
//
// Input angkanya sengaja tidak memakai <CurrencyInput> yang sudah ada: komponen
// itu menyimpan nilai sebagai string digit dan membuang koma, sedangkan di sini
// yang diketik bukan cuma rupiah bulat — ada persen diskon dan pecahan (mis.
// 12,5%). Yang ditiru dari sumber: teks tetap apa adanya selama fokus, baru
// dirapikan jadi format ribuan saat blur, supaya kursor tidak lompat.

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Format ──────────────────────────────────────────────────────────────────

export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("id-ID");
}

export function fmtRp(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `Rp ${fmtNum(n)}`;
}

/** "1.234,5" → 1234.5 · input kosong/sampah → 0. */
export function parseIdr(s: string): number {
  return parseFloat(String(s).replace(/\./g, "").replace(",", ".")) || 0;
}

const tampil = (v: number): string => (v > 0 ? Math.round(v).toLocaleString("id-ID") : "0");

// ── Input angka ─────────────────────────────────────────────────────────────

function useAngka(value: number, onChange: (v: number) => void) {
  const [text, setText] = useState(() => tampil(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(tampil(value));
  }, [value]);
  return {
    value: text,
    inputMode: "numeric" as const,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      editing.current = true;
      e.target.select();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      setText(e.target.value);
      onChange(parseIdr(e.target.value));
    },
    onBlur: () => {
      editing.current = false;
      const v = parseIdr(text);
      setText(tampil(v));
      onChange(v);
    },
  };
}

/** Input angka berlabel, dengan awalan "Rp" atau akhiran satuan. */
export function AngkaField({
  label, value, onChange, prefix, suffix, disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
}) {
  const bind = useAngka(value, onChange);
  return (
    <label className="block space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <span className="relative block">
        {prefix ? (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
            {prefix}
          </span>
        ) : null}
        <Input
          {...bind}
          disabled={disabled}
          className={cn("bg-card text-right tabular-nums", prefix && "pl-9", suffix && "pr-12")}
        />
        {suffix ? (
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/** Input angka ringkas untuk di dalam tabel/baris. */
export function AngkaMini({
  value, onChange, lebar = "w-24", disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  lebar?: string;
  disabled?: boolean;
}) {
  const bind = useAngka(value, onChange);
  return (
    <Input {...bind} disabled={disabled} className={cn("bg-card h-7 text-right tabular-nums", lebar)} />
  );
}

// ── Tampilan angka turunan ──────────────────────────────────────────────────

/** Baris "label — nilai" di dalam kartu input. */
export function Stat({
  label, value, tone = "netral", kuat,
}: {
  label: string;
  value: ReactNode;
  tone?: "netral" | "biaya" | "sorot" | "peringatan";
  kuat?: boolean;
}) {
  const warna =
    tone === "biaya" ? "text-destructive"
      : tone === "sorot" ? "text-primary"
      : tone === "peringatan" ? "text-amber-600 dark:text-amber-500"
      : "text-foreground";
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", kuat && "border-t pt-2")}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={cn("text-sm font-semibold tabular-nums", warna, kuat && "text-base")}>{value}</span>
    </div>
  );
}

/** Deretan tombol pilihan (kategori, analyzer, mode) — pola tab repo. */
export function PilihanBaris<T extends string>({
  label, value, options, onChange,
}: {
  label?: string;
  value: T;
  options: { key: T; label: string; sub?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {label ? (
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{label}</span>
      ) : null}
      <div className="flex flex-wrap gap-1 rounded-lg border p-1">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              value === o.key ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {o.label}
            {o.sub ? <span className="ml-1.5 text-[10px] opacity-70">{o.sub}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kartu angka utama di halaman hasil. */
export function HeroBiaya({
  judul, nilai, keterangan, pills,
}: {
  judul: string;
  nilai: string;
  keterangan?: ReactNode;
  pills: { label: string; value: string; tone?: "biaya" | "sorot" | "peringatan" }[];
}) {
  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-5 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-1">
        <div className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">{judul}</div>
        <div className="text-primary text-3xl font-bold tabular-nums">{nilai}</div>
        {keterangan ? <div className="text-muted-foreground text-xs">{keterangan}</div> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {pills.map((p) => (
          <span
            key={p.label}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs font-medium tabular-nums",
              p.tone === "biaya" && "border-destructive/30 text-destructive",
              p.tone === "peringatan" && "border-amber-500/30 text-amber-600 dark:text-amber-500",
              p.tone === "sorot" && "border-primary/30 text-primary",
            )}
          >
            <span className="text-muted-foreground mr-1 font-normal">{p.label}</span>
            {p.value}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Kartu CAPEX ─────────────────────────────────────────────────────────────

/**
 * CAPEX untuk kategori tanpa analyzer backup (Crossmatch, CLIA, HPLC,
 * Elektrolit, Blood Gas) — sama seperti aplikasi asal, opsi backup memang cuma
 * ada di Hematologi & Kimia Klinik.
 */
export function KartuCapex({
  price, disc, onPrice, onDisc, ups, lis, onUps, onLis, nettAlat, total, labelAlat = "Harga alat",
}: {
  price: number;
  disc: number;
  onPrice: (v: number) => void;
  onDisc: (v: number) => void;
  ups: number;
  lis: number;
  onUps: (v: number) => void;
  onLis: (v: number) => void;
  nettAlat: number;
  total: number;
  labelAlat?: string;
}) {
  return (
    <div className="space-y-3">
      <AngkaField label={labelAlat} value={price} onChange={onPrice} prefix="Rp" />
      <AngkaField label="Diskon" value={disc} onChange={onDisc} suffix="%" />
      <Stat label="Nett alat" value={fmtRp(nettAlat)} />
      <AngkaField label="UPS" value={ups} onChange={onUps} prefix="Rp" />
      <AngkaField label="LIS" value={lis} onChange={onLis} prefix="Rp" />
      <Stat label="Total CAPEX" value={fmtRp(total)} kuat />
    </div>
  );
}

/** Sepasang input harga + diskon, bentuk yang berulang di semua kategori. */
export function HargaDiskon({
  label, price, disc, onPrice, onDisc, nett,
}: {
  label: string;
  price: number;
  disc: number;
  onPrice: (v: number) => void;
  onDisc: (v: number) => void;
  nett?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold">{label}</div>
      <div className="grid grid-cols-[1fr_5rem] gap-2">
        <AngkaField label="Harga / kemasan" value={price} onChange={onPrice} prefix="Rp" />
        <AngkaField label="Diskon" value={disc} onChange={onDisc} suffix="%" />
      </div>
      {nett !== undefined ? (
        <div className="text-muted-foreground text-right text-[11px]">
          Nett: <span className="text-foreground font-semibold">{fmtRp(nett)}</span>
        </div>
      ) : null}
    </div>
  );
}
