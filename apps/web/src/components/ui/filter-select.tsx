"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Dropdown filter untuk toolbar DataTable. Dipakai daftar panjang yang kotak
// cari bebasnya saja tidak cukup (harga keagenan ±1.000 SKU, kode produk ±1.000).
//
// Pakai <select> asli, bukan komponen Select di components/ui/select.tsx: yang itu
// Base UI, dan <SelectValue/> di sana menampilkan value MENTAH kalau tanpa render
// function — untuk filter yang value-nya id ('02', '09') labelnya jadi tak terbaca.
// <select> asli juga membawa pencarian-ketik & aksesibilitas bawaan browser gratis.
export interface FilterOption {
  value: string;
  label: string;
}

export function FilterSelect({
  label, value, onChange, options, semua = "Semua", disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  /** Label untuk pilihan "tanpa filter" (value ""). */
  semua?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="whitespace-nowrap">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[12rem] rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground disabled:opacity-50"
      >
        <option value="">{semua}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Dropdown dengan kotak cari di dalamnya — untuk daftar opsi yang panjang
 *  (brand ±90, product line 57, sub class ratusan). `<select>` asli tidak cukup di
 *  situ: menggulung 90 baris untuk mencari satu brand lebih lambat daripada
 *  mengetik tiga huruf.
 *
 *  Sengaja tidak memakai `<Select>` di ui/select.tsx (Base UI): selain jebakan
 *  `<SelectValue/>` yang menampilkan value mentah, komponen itu tidak punya
 *  pencarian bawaan. */
export function FilterCombo({
  label, value, onChange, options, semua = "Semua", disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  semua?: string;
  disabled?: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const wrap = useRef<HTMLDivElement>(null);

  // Klik di luar menutup panel. Tanpa ini panel menggantung saat user pindah ke
  // filter lain, dan dua panel terbuka sekaligus bikin tabel tertutup.
  useEffect(() => {
    if (!buka) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setBuka(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [buka]);

  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, cari]);

  const pilih = (v: string) => {
    onChange(v);
    setCari("");
    setBuka(false);
  };
  const terpilih = options.find((o) => o.value === value)?.label ?? semua;

  return (
    <div className="relative" ref={wrap}>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="whitespace-nowrap">{label}</span>
        <button
          type="button"
          disabled={disabled}
          aria-expanded={buka}
          onClick={() => { setBuka((b) => !b); setCari(""); }}
          className={`flex max-w-[12rem] items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs disabled:opacity-50 ${value ? "font-medium text-foreground" : "text-muted-foreground"}`}
        >
          <span className="truncate">{terpilih}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </label>

      {buka && (
        <div className="absolute left-0 z-20 mt-1 w-60 rounded-md border bg-background p-1 shadow-lg">
          <input
            autoFocus
            value={cari}
            onChange={(e) => setCari(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setBuka(false);
              // Enter = ambil hasil teratas; kebiasaan yang sama dengan kotak cari
              // tabel di sebelahnya.
              if (e.key === "Enter" && cocok.length > 0) pilih(cocok[0].value);
            }}
            placeholder={`Cari ${label.toLowerCase()}…`}
            className="mb-1 w-full rounded border border-input bg-background px-2 py-1 text-xs"
          />
          <div className="max-h-56 overflow-y-auto" role="listbox">
            <button
              type="button" role="option" aria-selected={!value}
              onClick={() => pilih("")}
              className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${!value ? "bg-muted" : ""}`}
            >
              {semua}
            </button>
            {cocok.map((o) => (
              <button
                key={o.value} type="button" role="option" aria-selected={o.value === value}
                onClick={() => pilih(o.value)}
                className={`block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted ${o.value === value ? "bg-muted font-medium" : ""}`}
                title={o.label}
              >
                {o.label}
              </button>
            ))}
            {cocok.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Tidak ada yang cocok.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Daftar nilai unik terurut untuk mengisi FilterSelect/FilterCombo dari data yang ada di layar. */
export function opsiDari<T>(rows: T[], ambil: (r: T) => string | null | undefined): FilterOption[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = (ambil(r) ?? "").trim();
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "id")).map((v) => ({ value: v, label: v }));
}
