"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface EligibleUnit {
  id: string;
  alat_name: string;
  serial_number: string | null;
  customer_name: string;
  cabang: string | null;
  bast_at: string | null;
}

const blank = () => ({
  installation_unit_id: "",
  interval_bulan: "6",
  reference_date: "",
  teknisi_name: "",
  teknisi_wa_number: "",
});

export function AddMaintenanceSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());
  const [units, setUnits] = useState<EligibleUnit[]>([]);

  useEffect(() => {
    if (!open) return;
    void fetch("/api/maintenance/eligible-units", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUnits(d?.units ?? []))
      .catch(() => {});
  }, [open]);

  function selectUnit(id: string) {
    const u = units.find((x) => x.id === id);
    setF((p) => ({ ...p, installation_unit_id: id, reference_date: u?.bast_at ? u.bast_at.slice(0, 10) : "" }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          installation_unit_id: f.installation_unit_id,
          interval_bulan: Number(f.interval_bulan),
          reference_date: f.reference_date || undefined,
          teknisi_name: f.teknisi_name.trim() || undefined,
          teknisi_wa_number: f.teknisi_wa_number.trim() || undefined,
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
        <Plus /> Tambah schedule
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah schedule PM/kalibrasi</SheetTitle>
          <SheetDescription>Alat harus sudah BAST (lifecycle instalasi selesai) & belum punya schedule.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ms-unit">Alat *</Label>
              <select
                id="ms-unit"
                required
                className={selectCls}
                value={f.installation_unit_id}
                onChange={(e) => selectUnit(e.target.value)}
              >
                <option value="" disabled>
                  {units.length === 0 ? "tidak ada alat eligible" : "pilih alat…"}
                </option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.alat_name} — {u.customer_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-interval">Interval (bulan) *</Label>
              <Input
                id="ms-interval"
                type="number"
                min={1}
                required
                value={f.interval_bulan}
                onChange={(e) => setF((p) => ({ ...p, interval_bulan: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-ref">Tanggal acuan</Label>
              <Input
                id="ms-ref"
                type="date"
                value={f.reference_date}
                onChange={(e) => setF((p) => ({ ...p, reference_date: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-teknisi">Nama teknisi</Label>
              <Input id="ms-teknisi" value={f.teknisi_name} onChange={(e) => setF((p) => ({ ...p, teknisi_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-wa">No. WA teknisi</Label>
              <Input id="ms-wa" value={f.teknisi_wa_number} onChange={(e) => setF((p) => ({ ...p, teknisi_wa_number: e.target.value }))} placeholder="62812xxxxxxx" />
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
