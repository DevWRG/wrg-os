"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

// Dropdown-dengan-kotak-cari untuk FORM (lebar penuh, h-9, text-sm) — sejajar
// dengan <Input> di sebelahnya.
//
// Sepupunya, FilterCombo di ui/filter-select.tsx, memecahkan masalah yang sama
// untuk toolbar DataTable (inline, text-xs, selalu punya opsi "Semua"). Dibiarkan
// terpisah supaya penyetelan tampilan toolbar tidak menyeret field form, dan
// sebaliknya. Alasan tidak memakai <Select> Base UI sama seperti yang ditulis di
// file itu: tidak punya pencarian bawaan.
export interface ComboboxOption {
  value: string;
  label: string;
}

export function Combobox({
  value, onChange, options, id, placeholder = "— pilih —", emptyText = "Tidak ada yang cocok.",
  searchPlaceholder = "Ketik untuk mencari…", disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  /** Dipasang di tombol pemicu, supaya <Label htmlFor> tetap menyorot field ini. */
  id?: string;
  placeholder?: string;
  emptyText?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const [sorot, setSorot] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const daftar = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Klik di luar menutup panel — tanpa ini panel menggantung saat user pindah field.
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

  // Gulung baris tersorot ke dalam pandangan saat navigasi panah.
  useEffect(() => {
    if (!buka) return;
    daftar.current?.querySelector<HTMLElement>('[data-sorot="1"]')?.scrollIntoView({ block: "nearest" });
  }, [sorot, buka]);

  const pilih = (v: string) => {
    onChange(v);
    setCari("");
    setBuka(false);
  };
  const terpilih = options.find((o) => o.value === value)?.label;

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setBuka(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSorot((i) => Math.min(i + 1, cocok.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSorot((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && cocok[sorot]) { e.preventDefault(); pilih(cocok[sorot].value); }
  }

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button" id={id} disabled={disabled}
        role="combobox" aria-expanded={buka} aria-haspopup="listbox" aria-controls={listId}
        onClick={() => { setBuka((b) => !b); setCari(""); setSorot(0); }}
        className={`flex h-9 w-full items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-left text-sm disabled:opacity-50 ${terpilih ? "text-foreground" : "text-muted-foreground"}`}
      >
        <span className="truncate">{terpilih ?? placeholder}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
      </button>

      {buka && (
        <div className="absolute left-0 z-20 mt-1 w-full rounded-md border bg-background p-1 shadow-lg">
          <input
            autoFocus
            value={cari}
            /* Daftar menyusut saat mengetik; sorot harus balik ke baris pertama,
               kalau tidak ia menunjuk baris yang sudah tersaring keluar. */
            onChange={(e) => { setCari(e.target.value); setSorot(0); }}
            onKeyDown={onKey}
            placeholder={searchPlaceholder}
            className="mb-1 w-full rounded border border-input bg-background px-2 py-1 text-sm"
          />
          <div ref={daftar} id={listId} className="max-h-56 overflow-y-auto" role="listbox">
            {cocok.map((o, i) => (
              <button
                key={o.value} type="button" role="option" aria-selected={o.value === value}
                data-sorot={i === sorot ? "1" : undefined}
                onMouseEnter={() => setSorot(i)}
                onClick={() => pilih(o.value)}
                title={o.label}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm ${i === sorot ? "bg-muted" : ""} ${o.value === value ? "font-medium" : ""}`}
              >
                <Check className={`h-3.5 w-3.5 shrink-0 ${o.value === value ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {cocok.length === 0 && (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
