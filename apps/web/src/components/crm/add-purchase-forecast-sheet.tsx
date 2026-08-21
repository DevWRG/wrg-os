"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// F41 — pola native <select> yang sama dgn add-purchase-order-sheet.tsx (F35).
const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const now = new Date();
const blank = () => ({
  period_year: String(now.getFullYear()),
  period_month: String(now.getMonth() + 1),
  lini: "" as "" | "IVD" | "Medical",
  forecast_value: "",
  forecast_qty: "",
  notes: "",
});

export function AddPurchaseForecastSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/purchase-forecast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          period_year: Number(f.period_year),
          period_month: Number(f.period_month),
          lini: f.lini || undefined,
          forecast_value: Number(f.forecast_value),
          forecast_qty: f.forecast_qty ? Number(f.forecast_qty) : undefined,
          notes: f.notes.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(blank());
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus /> Tambah Forecast
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah rencana pembelian</SheetTitle>
          <SheetDescription>Forecast per periode (bulan/tahun) + lini opsional, dibandingkan otomatis terhadap realisasi PO.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="pf-year">Tahun *</Label>
                <Input id="pf-year" type="number" required min={2000} value={f.period_year} onChange={(e) => setF((p) => ({ ...p, period_year: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pf-month">Bulan *</Label>
                <select
                  id="pf-month"
                  required
                  className={selectCls}
                  value={f.period_month}
                  onChange={(e) => setF((p) => ({ ...p, period_month: e.target.value }))}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>
                      {new Date(2000, m - 1, 1).toLocaleDateString("id-ID", { month: "long" })}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-lini">Lini Bisnis</Label>
              <select
                id="pf-lini"
                className={selectCls}
                value={f.lini}
                onChange={(e) => setF((p) => ({ ...p, lini: e.target.value as "" | "IVD" | "Medical" }))}
              >
                <option value="">Seluruh lini</option>
                <option value="IVD">IVD</option>
                <option value="Medical">Medical</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-value">Nilai Rencana (Rp) *</Label>
              <Input id="pf-value" type="number" required min={0} step="1" value={f.forecast_value} onChange={(e) => setF((p) => ({ ...p, forecast_value: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-qty">Kuantitas Rencana</Label>
              <Input id="pf-qty" type="number" min={0} step="1" value={f.forecast_qty} onChange={(e) => setF((p) => ({ ...p, forecast_qty: e.target.value }))} placeholder="Opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pf-notes">Catatan</Label>
              <Textarea id="pf-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
