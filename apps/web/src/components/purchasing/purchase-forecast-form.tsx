"use client";

import { useState } from "react";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { CurrencyInput } from "@/components/ui/currency-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";

export interface ForecastVendor { id: number; name: string }

export interface PurchaseForecast {
  id: string;
  period_year: number;
  period_month: number;
  lini: "IVD" | "Medical" | null;
  vendor_id: number | null;
  vendor_name: string | null;
  forecast_value: number;
  notes: string | null;
  created_by: string | null;
  actual_value: number;
  gap_value: number;
  gap_percent: number | null;
}

export const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

// Tambah / edit forecast pembelian (rupiah) per bulan × lini × vendor.
// Periode terkunci saat edit (API menolak pindah periode).
export function PurchaseForecastForm({
  vendors,
  defaultYear,
  defaultMonth,
  existing,
  onSaved,
}: {
  vendors: ForecastVendor[];
  defaultYear: number;
  defaultMonth: number;
  existing?: PurchaseForecast;
  onSaved: () => void;
}) {
  const edit = !!existing;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const awal = () => ({
    year: String(existing?.period_year ?? defaultYear),
    month: String(existing?.period_month ?? defaultMonth),
    lini: existing?.lini ?? "",
    vendor: existing?.vendor_id != null ? String(existing.vendor_id) : "",
    value: existing ? String(Math.round(existing.forecast_value)) : "",
    notes: existing?.notes ?? "",
  });
  const [f, setF] = useState(awal);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.value) return setError("Isi nilai forecast (Rp).");
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(edit ? {} : { period_year: Number(f.year), period_month: Number(f.month) }),
        lini: f.lini || null,
        vendor_id: f.vendor ? Number(f.vendor) : null,
        forecast_value: Number(f.value),
        notes: f.notes.trim() || null,
      };
      const res = await fetch(edit ? `/api/purchase-forecast/${existing!.id}` : "/api/purchase-forecast", {
        method: edit ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  const tahunIni = new Date().getFullYear();
  const tahunPilihan = [tahunIni - 1, tahunIni, tahunIni + 1];

  return (
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (o) { setF(awal()); setError(null); } }}>
      <SheetTrigger render={edit ? <Button size="sm" variant="outline" title="Edit forecast" /> : <Button size="sm" />}>
        {edit ? <Pencil /> : <><Plus /> Tambah Forecast</>}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{edit ? "Edit Forecast" : "Tambah Forecast Pembelian"}</SheetTitle>
          <SheetDescription>
            Rencana pembelian (Rp) per bulan. Lini & vendor kosong = semua. Realisasi dihitung otomatis dari PO Accurate.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pf-bulan">Bulan</Label>
                <select id="pf-bulan" className={selectCls} value={f.month} disabled={edit} onChange={(e) => setF((p) => ({ ...p, month: e.target.value }))}>
                  {BULAN.map((b, i) => <option key={b} value={String(i + 1)}>{b}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-tahun">Tahun</Label>
                <select id="pf-tahun" className={selectCls} value={f.year} disabled={edit} onChange={(e) => setF((p) => ({ ...p, year: e.target.value }))}>
                  {[...new Set([...tahunPilihan, Number(f.year)])].sort().map((y) => <option key={y} value={String(y)}>{y}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-lini">Lini</Label>
              <select id="pf-lini" className={selectCls} value={f.lini} onChange={(e) => setF((p) => ({ ...p, lini: e.target.value as "" | "IVD" | "Medical" }))}>
                <option value="">Semua lini</option>
                <option value="IVD">IVD</option>
                <option value="Medical">Medical</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-vendor">Vendor</Label>
              <Combobox
                id="pf-vendor"
                value={f.vendor}
                onChange={(v) => setF((p) => ({ ...p, vendor: v }))}
                options={vendors.map((v) => ({ value: String(v.id), label: v.name }))}
                emptyOption="Semua vendor"
                placeholder="Semua vendor"
                searchPlaceholder="Cari vendor…"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-nilai">Nilai Forecast *</Label>
              <CurrencyInput id="pf-nilai" value={f.value} onChange={(v) => setF((p) => ({ ...p, value: v }))} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-notes">Catatan</Label>
              <Textarea id="pf-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="opsional" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy || !f.value}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
