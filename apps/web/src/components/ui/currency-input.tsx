"use client";

import { Input } from "@/components/ui/input";

// Input angka berformat ribuan (id-ID) di tampilan, simpan digit mentah (string).
// Opsional prefix "Rp". Dipakai form target (dan bisa dipakai ulang di tempat lain).
export function CurrencyInput({
  id,
  value,
  onChange,
  prefix = "Rp",
  className,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (raw: string) => void;
  prefix?: string | null;
  className?: string;
  placeholder?: string;
}) {
  const raw = value.replace(/\D/g, "");
  const display = raw === "" ? "" : Number(raw).toLocaleString("id-ID");
  const input = (
    <Input
      id={id}
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      className={[prefix ? "pl-9" : "", "text-right tabular-nums", className ?? ""].join(" ").trim()}
    />
  );
  if (!prefix) return input;
  return (
    <div className="relative">
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm">
        {prefix}
      </span>
      {input}
    </div>
  );
}
