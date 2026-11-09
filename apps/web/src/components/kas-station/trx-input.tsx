"use client";

import { ArrowDownLeft, ArrowUpRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { JenisTransaksi } from "./types";

// F33 — masukan satu transaksi kas: tombol Keluar/Masuk (bukan dropdown), nominal, uraian,
// nomor nota. Dipakai form catat harian dan form tambah transaksi di detail.

export interface BarisTrx { jenis: JenisTransaksi; nominal: string; uraian: string; bukti_ref: string }
export const trxKosong = (jenis: JenisTransaksi = "keluar"): BarisTrx => ({ jenis, nominal: "", uraian: "", bukti_ref: "" });

/** Kosong total (diabaikan saat simpan) vs terisi sebagian (galat). */
export const barisKosong = (b: BarisTrx): boolean => !b.nominal && !b.uraian.trim() && !b.bukti_ref.trim();
export const nominalAngka = (b: BarisTrx): number => (b.nominal ? Number(b.nominal) : 0);

export function JenisToggle({ value, onChange }: { value: JenisTransaksi; onChange: (j: JenisTransaksi) => void }) {
  const opsi: { j: JenisTransaksi; label: string; Icon: typeof ArrowUpRight; aktif: string }[] = [
    { j: "keluar", label: "Keluar", Icon: ArrowUpRight, aktif: "border-red-600 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-500/15 dark:text-red-300" },
    { j: "masuk", label: "Masuk", Icon: ArrowDownLeft, aktif: "border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-500 dark:bg-emerald-500/15 dark:text-emerald-300" },
  ];
  return (
    <div role="radiogroup" aria-label="Jenis transaksi" className="inline-flex h-9 shrink-0 rounded-md border bg-card p-0.5">
      {opsi.map(({ j, label, Icon, aktif }) => (
        <button
          key={j} type="button" role="radio" aria-checked={value === j} onClick={() => onChange(j)}
          className={cn("inline-flex items-center gap-1 rounded-[5px] border border-transparent px-2.5 text-sm font-medium transition-colors",
            value === j ? aktif : "text-muted-foreground hover:text-foreground")}
        >
          <Icon className="size-3.5" />{label}
        </button>
      ))}
    </div>
  );
}

export function TrxInput({ b, onChange, onHapus, autoFocus }: {
  b: BarisTrx; onChange: (p: Partial<BarisTrx>) => void; onHapus?: () => void; autoFocus?: boolean;
}) {
  return (
    <div className="grid items-center gap-2 sm:grid-cols-[auto_9.5rem_1fr_8.5rem_auto]">
      <JenisToggle value={b.jenis} onChange={(jenis) => onChange({ jenis })} />
      <CurrencyInput value={b.nominal} onChange={(nominal) => onChange({ nominal })} placeholder="0" />
      <Input aria-label="Uraian" placeholder="Untuk apa? (wajib)" maxLength={500} value={b.uraian} autoFocus={autoFocus}
        onChange={(e) => onChange({ uraian: e.target.value })} />
      <Input aria-label="Nomor nota/bukti" placeholder="No. nota" maxLength={500} value={b.bukti_ref}
        onChange={(e) => onChange({ bukti_ref: e.target.value })} />
      {onHapus ? (
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Hapus baris" onClick={onHapus}><Trash2 /></Button>
      ) : <span className="hidden sm:block sm:w-7" />}
    </div>
  );
}
