"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/components/ui/use-confirm";
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

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Props {
  id: string;
  period_year: number;
  period_month: number;
  lini: "IVD" | "Medical" | null;
  forecast_value: number;
  forecast_qty: number | null;
  notes: string | null;
}

export function PurchaseForecastRowActions({ id, period_year, period_month, lini, forecast_value, forecast_qty, notes }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    lini: (lini ?? "") as "" | "IVD" | "Medical",
    forecast_value: String(forecast_value),
    forecast_qty: forecast_qty != null ? String(forecast_qty) : "",
    notes: notes ?? "",
  });

  const { confirm, dialog } = useConfirm();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/purchase-forecast/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lini: f.lini || null,
          forecast_value: Number(f.forecast_value),
          forecast_qty: f.forecast_qty ? Number(f.forecast_qty) : null,
          notes: f.notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  function del() {
    confirm(
      { title: "Hapus forecast?", description: `Rencana pembelian periode ${period_month}/${period_year} akan dihapus.`, destructive: true, confirmLabel: "Hapus" },
      async () => {
        setBusy(true);
        try {
          const res = await fetch(`/api/purchase-forecast/${id}`, { method: "DELETE" });
          if (!res.ok) throw new Error("gagal hapus");
          router.refresh();
        } catch {
          setBusy(false);
        }
      },
    );
  }

  return (
    <div className="flex justify-end gap-1">
      {dialog}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit" />}>
          <Pencil />
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Edit forecast</SheetTitle>
            <SheetDescription>Periode {period_month}/{period_year}</SheetDescription>
          </SheetHeader>
          <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
              <div className="grid gap-1.5">
                <Label htmlFor={`pfe-lini-${id}`}>Lini Bisnis</Label>
                <select
                  id={`pfe-lini-${id}`}
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
                <Label htmlFor={`pfe-value-${id}`}>Nilai Rencana (Rp) *</Label>
                <Input id={`pfe-value-${id}`} type="number" required min={0} step="1" value={f.forecast_value} onChange={(e) => setF((p) => ({ ...p, forecast_value: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`pfe-qty-${id}`}>Kuantitas Rencana</Label>
                <Input id={`pfe-qty-${id}`} type="number" min={0} step="1" value={f.forecast_qty} onChange={(e) => setF((p) => ({ ...p, forecast_qty: e.target.value }))} placeholder="Opsional" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor={`pfe-notes-${id}`}>Catatan</Label>
                <Textarea id={`pfe-notes-${id}`} value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} />
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
      <Button variant="ghost" size="icon-sm" aria-label="Hapus" disabled={busy} onClick={del} className="text-danger hover:text-danger">
        <Trash2 />
      </Button>
    </div>
  );
}
