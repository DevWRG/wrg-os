"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

// Dropdown dengan kotak cari di dalamnya — untuk daftar opsi yang panjang, di mana
// `<select>` asli tidak cukup: menggulung 90 baris untuk mencari satu brand lebih
// lambat daripada mengetik tiga huruf.
//
// Sengaja tidak memakai <Select> di ui/select.tsx (Base UI): komponen itu tidak
// punya pencarian bawaan, dan <SelectValue/> di sana menampilkan value MENTAH kalau
// tanpa render function — untuk opsi yang value-nya id ('02', '09') labelnya jadi
// tak terbaca.
//
// Dua ukuran, satu implementasi:
// - `default` — field form, lebar penuh, sejajar dengan <Input> di sebelahnya.
// - `sm`      — toolbar DataTable, ringkas, label menempel di kiri. Preset toolbar
//               (lebar panel, teks "Cari …") ada di FilterCombo, ui/filter-select.tsx.
export interface ComboboxOption {
  value: string;
  label: string;
}

export function Combobox({
  value, onChange, options, id, label, size = "default", disabled,
  placeholder = "— pilih —", emptyOption, triggerClassName,
  searchPlaceholder = "Ketik untuk mencari…", emptyText = "Tidak ada yang cocok.",
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboboxOption[];
  /** Dipasang di tombol pemicu, supaya <Label htmlFor> dari luar tetap menyorot field ini. */
  id?: string;
  /** Label inline di kiri pemicu (gaya toolbar). Form memakai <Label> terpisah, bukan ini. */
  label?: string;
  size?: "default" | "sm";
  disabled?: boolean;
  /** Teks pemicu saat belum ada yang dipilih. */
  placeholder?: string;
  /** Kalau diisi, daftar diawali satu baris ber-value "" dengan teks ini (mis. "Semua"). */
  emptyOption?: string;
  triggerClassName?: string;
  searchPlaceholder?: string;
  emptyText?: string;
}) {
  const [buka, setBuka] = useState(false);
  const [cari, setCari] = useState("");
  const [sorot, setSorot] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const daftar = useRef<HTMLDivElement>(null);
  const listId = useId();
  const kecil = size === "sm";

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

  // Baris "tanpa filter" ikut disaring & bisa disorot seperti opsi biasa — supaya
  // navigasi panah tidak punya baris siluman yang dilewati.
  const semua = useMemo(
    () => (emptyOption ? [{ value: "", label: emptyOption }, ...options] : options),
    [emptyOption, options],
  );
  const cocok = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return q ? semua.filter((o) => o.label.toLowerCase().includes(q)) : semua;
  }, [semua, cari]);

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

  const pemicu = (
    <button
      type="button" id={id} disabled={disabled}
      role="combobox" aria-expanded={buka} aria-haspopup="listbox" aria-controls={listId}
      onClick={() => { setBuka((b) => !b); setCari(""); setSorot(0); }}
      className={cn(
        "flex items-center justify-between gap-1 rounded-md border border-input bg-background text-left disabled:opacity-50",
        kecil ? "px-2 py-1 text-xs" : "h-9 w-full px-2 text-sm",
        terpilih ? "font-medium text-foreground" : "text-muted-foreground",
        triggerClassName,
      )}
    >
      <span className="truncate">{terpilih ?? placeholder}</span>
      <ChevronDown className={cn("shrink-0 opacity-60", kecil ? "h-3 w-3" : "h-4 w-4")} />
    </button>
  );

  return (
    <div className="relative" ref={wrap}>
      {/* Panel sengaja DI LUAR <label>: kalau di dalam, klik di panel diteruskan
          browser ke tombol pemicu dan panel langsung menutup lagi. */}
      {label ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{label}</span>
          {pemicu}
        </label>
      ) : pemicu}

      {buka && (
        <div className={cn("absolute left-0 z-20 mt-1 rounded-md border bg-background p-1 shadow-lg", kecil ? "w-60" : "w-full")}>
          <input
            autoFocus
            value={cari}
            /* Daftar menyusut saat mengetik; sorot harus balik ke baris pertama,
               kalau tidak ia menunjuk baris yang sudah tersaring keluar. */
            onChange={(e) => { setCari(e.target.value); setSorot(0); }}
            onKeyDown={onKey}
            placeholder={searchPlaceholder}
            className={cn("mb-1 w-full rounded border border-input bg-background px-2 py-1", kecil ? "text-xs" : "text-sm")}
          />
          <div ref={daftar} id={listId} className="max-h-56 overflow-y-auto" role="listbox">
            {cocok.map((o, i) => (
              <button
                key={o.value} type="button" role="option" aria-selected={o.value === value}
                data-sorot={i === sorot ? "1" : undefined}
                onMouseEnter={() => setSorot(i)}
                onClick={() => pilih(o.value)}
                title={o.label}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left",
                  kecil ? "text-xs" : "text-sm",
                  i === sorot && "bg-muted",
                  o.value === value && "font-medium",
                )}
              >
                <Check className={cn("h-3.5 w-3.5 shrink-0", o.value === value ? "opacity-100" : "opacity-0")} />
                <span className="truncate">{o.label}</span>
              </button>
            ))}
            {cocok.length === 0 && (
              <p className={cn("px-2 py-1.5 text-muted-foreground", kecil ? "text-xs" : "text-sm")}>{emptyText}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
