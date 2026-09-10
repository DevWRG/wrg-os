"use client";

import { useState } from "react";
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

const blank = () => ({
  plate_number: "",
  model: "",
  sopir_name: "",
  current_km: "",
  stnk_expiry: "",
  service_interval_km: "",
});

export function AddVehicleSheet() {
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
      const res = await fetch("/api/vehicles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plate_number: f.plate_number.trim(),
          model: f.model.trim() || undefined,
          sopir_name: f.sopir_name.trim() || undefined,
          current_km: f.current_km.trim() ? Number(f.current_km) : undefined,
          stnk_expiry: f.stnk_expiry || undefined,
          service_interval_km: f.service_interval_km.trim() ? Number(f.service_interval_km) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
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
    <Sheet open={open} onOpenChange={(o) => { setOpen(o); if (!o) { setF(blank()); setError(null); } }}>
      <SheetTrigger render={<Button size="sm" />}>
        <Plus /> Tambah kendaraan
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah kendaraan</SheetTitle>
          <SheetDescription>Data servis/BBM dicatat terpisah lewat log per kendaraan setelah ini.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="v-plate">Plat nomor *</Label>
              <Input id="v-plate" required value={f.plate_number} onChange={(e) => setF((p) => ({ ...p, plate_number: e.target.value }))} placeholder="mis. L 1234 AB" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-model">Model *</Label>
              <Input id="v-model" required value={f.model} onChange={(e) => setF((p) => ({ ...p, model: e.target.value }))} placeholder="mis. Toyota Avanza" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-sopir">Sopir *</Label>
              <Input id="v-sopir" required value={f.sopir_name} onChange={(e) => setF((p) => ({ ...p, sopir_name: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-km">KM saat ini *</Label>
              <Input id="v-km" type="number" min="0" required value={f.current_km} onChange={(e) => setF((p) => ({ ...p, current_km: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-stnk">Tanggal jatuh tempo STNK *</Label>
              <Input id="v-stnk" type="date" required value={f.stnk_expiry} onChange={(e) => setF((p) => ({ ...p, stnk_expiry: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-interval">Interval service (km) *</Label>
              <Input id="v-interval" type="number" min="1" required value={f.service_interval_km} onChange={(e) => setF((p) => ({ ...p, service_interval_km: e.target.value }))} />
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
