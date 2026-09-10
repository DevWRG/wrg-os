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

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ requested_by: "", purpose: "", amount_requested: "", request_date: today(), cabang: "", notes: "" });

export function AddDanaOpsSheet() {
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
      const res = await fetch("/api/dana-ops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          requested_by: f.requested_by.trim(),
          purpose: f.purpose.trim(),
          amount_requested: Number(f.amount_requested),
          request_date: f.request_date,
          cabang: f.cabang.trim() || undefined,
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
        <Plus /> Ajukan Dana
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Ajukan Dana Ops</SheetTitle>
          <SheetDescription>Buat pengajuan dana operasional/petty cash baru (F51). Bukti realisasi ditambah setelahnya.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="do-requested-by">Pemohon *</Label>
              <Input id="do-requested-by" required value={f.requested_by} onChange={(e) => setF((p) => ({ ...p, requested_by: e.target.value }))} placeholder="Nama pemohon" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="do-purpose">Keperluan *</Label>
              <Input id="do-purpose" required value={f.purpose} onChange={(e) => setF((p) => ({ ...p, purpose: e.target.value }))} placeholder="mis. Operasional cabang Jakarta Juli" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="do-amount">Nominal Diajukan *</Label>
                <Input id="do-amount" type="number" min="0" step="1" required value={f.amount_requested} onChange={(e) => setF((p) => ({ ...p, amount_requested: e.target.value }))} placeholder="1000000" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="do-date">Tgl Ajuan *</Label>
                <Input id="do-date" type="date" required value={f.request_date} onChange={(e) => setF((p) => ({ ...p, request_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="do-cabang">Cabang</Label>
              <Input id="do-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="do-notes">Catatan</Label>
              <Textarea id="do-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
