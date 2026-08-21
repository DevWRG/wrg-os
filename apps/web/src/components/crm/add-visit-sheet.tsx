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
  am_id: "",
  customer_name: "",
  visit_date: today(),
  photo_url: "",
  lat: "",
  lon: "",
  note: "",
});

const num = (s: string): number | undefined => {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};

export function AddVisitSheet() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(blank());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Koordinat WAJIB. Tanpa lat/lon, sales_plan.visit_lat tetap NULL dan
    // kunjungannya tidak akan pernah muncul di daftar ini (listVisits memfilter
    // `visit_lat IS NOT NULL`) — tersimpan tapi tak terlihat, dan itu terbaca
    // sebagai "gagal simpan" oleh yang mengisi. Cek angka dilakukan di sini,
    // bukan cuma lewat atribut `required`: `required` menangkap kolom kosong,
    // tapi teks non-angka ("abc") lolos HTML lalu jadi undefined di num().
    const lat = num(f.lat);
    const lon = num(f.lon);
    if (lat === undefined || lon === undefined) {
      setError("Latitude & longitude wajib diisi angka. Kunjungan tanpa koordinat tidak akan muncul di daftar ini.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          am_id: f.am_id.trim(),
          customer_name: f.customer_name.trim() || undefined,
          visit_date: f.visit_date || undefined,
          photo_url: f.photo_url.trim() || undefined,
          lat,
          lon,
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
        <Plus /> Tambah kunjungan
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tambah kunjungan</SheetTitle>
          <SheetDescription>
            Koordinat wajib — kunjungan tanpa geo tidak muncul di daftar ini. Geo divalidasi
            otomatis terhadap bbox Indonesia.
          </SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <div className="grid gap-1.5">
              <Label htmlFor="v-am-id">AM ID *</Label>
              <Input id="v-am-id" required value={f.am_id} onChange={(e) => setF((p) => ({ ...p, am_id: e.target.value }))} placeholder="AM-001" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-cust">Customer</Label>
              <Input id="v-cust" value={f.customer_name} onChange={(e) => setF((p) => ({ ...p, customer_name: e.target.value }))} placeholder="PT Contoh" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-date">Tanggal kunjungan</Label>
              <Input id="v-date" type="date" value={f.visit_date} onChange={(e) => setF((p) => ({ ...p, visit_date: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-photo">URL foto</Label>
              <Input id="v-photo" type="url" value={f.photo_url} onChange={(e) => setF((p) => ({ ...p, photo_url: e.target.value }))} placeholder="https://…/foto.jpg" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="v-lat">Latitude *</Label>
                <Input id="v-lat" required inputMode="decimal" value={f.lat} onChange={(e) => setF((p) => ({ ...p, lat: e.target.value }))} placeholder="-6.2" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="v-lon">Longitude *</Label>
                <Input id="v-lon" required inputMode="decimal" value={f.lon} onChange={(e) => setF((p) => ({ ...p, lon: e.target.value }))} placeholder="106.816" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="v-note">Catatan</Label>
              <Textarea id="v-note" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder="Ringkasan kunjungan…" />
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <SheetFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Menyimpan…" : "Simpan"}
            </Button>
            <SheetClose render={<Button type="button" variant="outline" />}>Batal</SheetClose>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
