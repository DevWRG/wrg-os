"use client";

import { useEffect, useState } from "react";
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

const selectCls =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface Unit {
  id: string;
  alat_name: string;
  customer_name: string;
  status: string;
}
interface Teknisi {
  id: string;
  nama: string;
  aktif: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);
const blank = () => ({ installation_unit_id: "", teknisi_id: "", scheduled_date: today(), note: "" });

export function AddScheduleSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [units, setUnits] = useState<Unit[]>([]);
  const [teknisi, setTeknisi] = useState<Teknisi[]>([]);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/installations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUnits((d?.units ?? []).filter((u: Unit) => u.status !== "bast")))
      .catch(() => {});
    void fetch("/api/teknisi-capacity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setTeknisi(d?.teknisi ?? []))
      .catch(() => {});
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/install-schedule", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installation_unit_id: f.installation_unit_id,
          teknisi_id: f.teknisi_id || undefined,
          scheduled_date: f.scheduled_date,
          note: f.note.trim() || undefined,
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
        <Plus /> Jadwalkan install
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Jadwalkan install</SheetTitle>
          <SheetDescription>Pilih alat yang belum BAST dari Instalasi Alat.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="is-unit">Alat *</Label>
              <select
                id="is-unit"
                required
                className={selectCls}
                value={f.installation_unit_id}
                onChange={(e) => setF((p) => ({ ...p, installation_unit_id: e.target.value }))}
              >
                <option value="" disabled>{units.length === 0 ? "tidak ada alat eligible" : "pilih alat…"}</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{u.alat_name} — {u.customer_name}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="is-teknisi">Teknisi</Label>
              <select
                id="is-teknisi"
                className={selectCls}
                value={f.teknisi_id}
                onChange={(e) => setF((p) => ({ ...p, teknisi_id: e.target.value }))}
              >
                <option value="">belum ditentukan</option>
                {teknisi.filter((t) => t.aktif).map((t) => (
                  <option key={t.id} value={t.id}>{t.nama}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="is-date">Tanggal *</Label>
              <Input id="is-date" type="date" required value={f.scheduled_date} onChange={(e) => setF((p) => ({ ...p, scheduled_date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="is-note">Catatan</Label>
              <Textarea id="is-note" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} />
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
