"use client";

import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

// Dropdown filter untuk toolbar DataTable. Dipakai daftar panjang yang kotak
// cari bebasnya saja tidak cukup (harga keagenan ±1.000 SKU, kode produk ±1.000).
//
// Pakai <select> asli, bukan komponen Select di components/ui/select.tsx: yang itu
// Base UI, dan <SelectValue/> di sana menampilkan value MENTAH kalau tanpa render
// function — untuk filter yang value-nya id ('02', '09') labelnya jadi tak terbaca.
// <select> asli juga membawa pencarian-ketik & aksesibilitas bawaan browser gratis.
export type FilterOption = ComboboxOption;

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

/** Preset toolbar dari <Combobox> (ui/combobox.tsx) — untuk daftar opsi yang panjang
 *  (brand ±90, product line 57, sub class ratusan), di mana `<select>` asli tidak
 *  cukup. Yang khas toolbar ada di sini: ukuran ringkas, label menempel di kiri,
 *  dan baris "Semua" untuk melepas filter. */
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
  return (
    <Combobox
      size="sm" label={label} value={value} onChange={onChange} options={options} disabled={disabled}
      placeholder={semua} emptyOption={semua} triggerClassName="max-w-[12rem]"
      searchPlaceholder={`Cari ${label.toLowerCase()}…`}
    />
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
