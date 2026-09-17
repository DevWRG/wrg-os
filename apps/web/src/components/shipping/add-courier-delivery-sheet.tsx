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

const blank = () => ({
  kurir_name: "",
  kurir_wa_number: "",
  sj_number: "",
  customer_name: "",
  cabang: "",
  tanggal_kirim: today(),
  target_tiba_date: "",
  distance_km: "",
  notes: "",
});

// Catat pengiriman baru (F43). kurir_name teks bebas — tidak ada roster
// kurir/ekspedisi di project ini (lihat komentar migrasi 095).
export function AddCourierDeliverySheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.kurir_name.trim()) {
      setError("Nama kurir/ekspedisi wajib diisi");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/courier-deliveries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kurir_name: f.kurir_name.trim(),
          kurir_wa_number: f.kurir_wa_number.trim() || undefined,
          sj_number: f.sj_number.trim() || undefined,
          customer_name: f.customer_name.trim() || undefined,
          cabang: f.cabang.trim() || undefined,
          tanggal_kirim: f.tanggal_kirim,
          target_tiba_date: f.target_tiba_date || undefined,
          distance_km: f.distance_km ? Number(f.distance_km) : undefined,
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
        <Plus /> Catat Pengiriman
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Catat Pengiriman</SheetTitle>
          <SheetDescription>Riwayat pengiriman per kurir/ekspedisi (F43).</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="cd-kurir">Kurir / Ekspedisi *</Label>
              <Input id="cd-kurir" required value={f.kurir_name} onChange={(e) => setF((p) => ({ ...p, kurir_name: e.target.value }))} placeholder="mis. Budi (internal) / JNE / JNT" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cd-wa">No. WA Kurir</Label>
              <Input id="cd-wa" value={f.kurir_wa_number} onChange={(e) => setF((p) => ({ ...p, kurir_wa_number: e.target.value }))} placeholder="0812xxxxxxx" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cd-sj">No. Surat Jalan</Label>
                <Input id="cd-sj" value={f.sj_number} onChange={(e) => setF((p) => ({ ...p, sj_number: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cd-cabang">Cabang</Label>
                <Input id="cd-cabang" value={f.cabang} onChange={(e) => setF((p) => ({ ...p, cabang: e.target.value }))} placeholder="mis. Jakarta" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cd-customer">Customer</Label>
              <Input id="cd-customer" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} placeholder="PT Contoh" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="cd-kirim">Tgl Kirim *</Label>
                <Input id="cd-kirim" type="date" required value={f.tanggal_kirim} onChange={(e) => setF((p) => ({ ...p, tanggal_kirim: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cd-target">Target Tiba</Label>
                <Input id="cd-target" type="date" value={f.target_tiba_date} onChange={(e) => setF((p) => ({ ...p, target_tiba_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cd-distance">Jarak (km)</Label>
              <Input id="cd-distance" type="number" min="0" step="any" value={f.distance_km} onChange={(e) => setF((p) => ({ ...p, distance_km: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cd-notes">Catatan</Label>
              <Textarea id="cd-notes" value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} placeholder="Catatan tambahan…" />
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
