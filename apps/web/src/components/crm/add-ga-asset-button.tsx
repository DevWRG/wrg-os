"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONDITION_LABEL } from "@/components/tables/ga-assets-table";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

const EMPTY = {
  nama: "", category_id: "", brand: "", model: "", serial_number: "",
  purchase_date: "", purchase_price: "", location: "", condition: "baik",
  is_critical: false,
};

export function AddGaAssetButton({ categories }: { categories: { id: string; nama: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState(EMPTY);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim(),
          category_id: f.category_id,
          brand: f.brand.trim() || undefined,
          model: f.model.trim() || undefined,
          serial_number: f.serial_number.trim() || undefined,
          purchase_date: f.purchase_date || undefined,
          purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
          location: f.location.trim() || undefined,
          condition: f.condition,
          is_critical: f.is_critical,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF(EMPTY);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus /> Tambah Aset
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tambah aset GA</DialogTitle>
          <DialogDescription>
            Kode aset (AST-YYYY-NNNN) di-generate otomatis. Foto & dokumen diisi SETELAH aset disimpan, lewat tombol Edit di tabel.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ga-nama">Nama</Label>
              <Input id="ga-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} placeholder="Laptop Dell Latitude 5430" />
            </div>
            <div className="grid gap-1.5">
              <Label>Kategori</Label>
              <Select value={f.category_id} onValueChange={(v) => setF((p) => ({ ...p, category_id: v ?? "" }))}>
                <SelectTrigger>
                  {/* Base UI SelectValue render raw value (UUID) tanpa render-fn — map ke nama kategori. */}
                  <SelectValue placeholder="Pilih kategori">{(v: string) => categories.find((c) => c.id === v)?.nama ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ga-brand">Brand</Label>
                <Input id="ga-brand" value={f.brand} onChange={(e) => setF((p) => ({ ...p, brand: e.target.value }))} placeholder="opsional" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ga-model">Model</Label>
                <Input id="ga-model" value={f.model} onChange={(e) => setF((p) => ({ ...p, model: e.target.value }))} placeholder="opsional" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ga-serial">Serial Number</Label>
              <Input id="ga-serial" value={f.serial_number} onChange={(e) => setF((p) => ({ ...p, serial_number: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ga-tgl">Tanggal Beli</Label>
                <Input id="ga-tgl" type="date" value={f.purchase_date} onChange={(e) => setF((p) => ({ ...p, purchase_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ga-harga">Harga Beli (Rp)</Label>
                <Input id="ga-harga" type="number" min={0} value={f.purchase_price} onChange={(e) => setF((p) => ({ ...p, purchase_price: e.target.value }))} placeholder="opsional" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ga-lokasi">Lokasi</Label>
              <Input id="ga-lokasi" value={f.location} onChange={(e) => setF((p) => ({ ...p, location: e.target.value }))} placeholder="mis. Lt.3 Marketing" />
            </div>
            <div className="grid gap-1.5">
              <Label>Kondisi</Label>
              <Select value={f.condition} onValueChange={(v) => setF((p) => ({ ...p, condition: v ?? "baik" }))}>
                <SelectTrigger><SelectValue>{(v: string) => CONDITION_LABEL[v] ?? v}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="baik">Baik</SelectItem>
                  <SelectItem value="rusak">Rusak</SelectItem>
                  <SelectItem value="kurang_layak_pakai">Kurang layak pakai</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.is_critical} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, is_critical: v }))} />
              <Label>Kritis (SLA tiket 2 jam kalau ada masalah)</Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy || !f.category_id}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
