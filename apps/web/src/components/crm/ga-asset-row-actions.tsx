"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Asset {
  id: string;
  asset_code: string;
  nama: string;
  category_id: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  location: string | null;
  pic_name: string | null;
  condition: string;
  status: string;
  is_critical: boolean;
  active: boolean;
}

// Override PIC manual di sini TIDAK menghasilkan histori assignment (beda dari
// aksi "Assign" resmi F133, ga_asset_assignments) — dipakai utk koreksi cepat
// (mis. typo nama) tanpa perlu alur formal.
export function GaAssetRowActions({ asset, categories }: { asset: Asset; categories: { id: string; nama: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: asset.nama,
    category_id: asset.category_id,
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serial_number: asset.serial_number ?? "",
    purchase_date: asset.purchase_date ?? "",
    purchase_price: asset.purchase_price ? String(asset.purchase_price) : "",
    current_value: asset.current_value ? String(asset.current_value) : "",
    location: asset.location ?? "",
    pic_name_override: asset.pic_name ?? "",
    condition: asset.condition,
    status: asset.status,
    is_critical: asset.is_critical,
    active: asset.active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-assets/${asset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          category_id: f.category_id || undefined,
          brand: f.brand.trim() || undefined,
          model: f.model.trim() || undefined,
          serial_number: f.serial_number.trim() || undefined,
          purchase_date: f.purchase_date || undefined,
          purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
          current_value: f.current_value ? Number(f.current_value) : undefined,
          location: f.location.trim() || undefined,
          pic_name_override: f.pic_name_override.trim(),
          condition: f.condition,
          status: f.status,
          is_critical: f.is_critical,
          active: f.active,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) throw new Error(data.error ?? "gagal menyimpan");
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
      <DialogTrigger render={<Button size="sm" variant="outline" title="Edit" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit — {asset.asset_code}</DialogTitle>
          <DialogDescription>
            Override PIC di sini hanya koreksi cepat (tanpa histori) — utk assign resmi pakai aksi Assign.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gae-nama">Nama</Label>
              <Input id="gae-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label>Kategori</Label>
              <Select value={f.category_id} onValueChange={(v) => setF((p) => ({ ...p, category_id: v ?? p.category_id }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.nama}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="gae-brand">Brand</Label>
                <Input id="gae-brand" value={f.brand} onChange={(e) => setF((p) => ({ ...p, brand: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gae-model">Model</Label>
                <Input id="gae-model" value={f.model} onChange={(e) => setF((p) => ({ ...p, model: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gae-serial">Serial Number</Label>
              <Input id="gae-serial" value={f.serial_number} onChange={(e) => setF((p) => ({ ...p, serial_number: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="gae-tgl">Tanggal Beli</Label>
                <Input id="gae-tgl" type="date" value={f.purchase_date} onChange={(e) => setF((p) => ({ ...p, purchase_date: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="gae-harga">Harga Beli (Rp)</Label>
                <Input id="gae-harga" type="number" min={0} value={f.purchase_price} onChange={(e) => setF((p) => ({ ...p, purchase_price: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gae-nilai">Nilai Sekarang (Rp)</Label>
              <Input id="gae-nilai" type="number" min={0} value={f.current_value} onChange={(e) => setF((p) => ({ ...p, current_value: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gae-lokasi">Lokasi</Label>
              <Input id="gae-lokasi" value={f.location} onChange={(e) => setF((p) => ({ ...p, location: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gae-pic">PIC (override cepat, tanpa histori)</Label>
              <Input id="gae-pic" value={f.pic_name_override} onChange={(e) => setF((p) => ({ ...p, pic_name_override: e.target.value }))} placeholder="kosongkan utk hapus" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Kondisi</Label>
                <Select value={f.condition} onValueChange={(v) => setF((p) => ({ ...p, condition: v ?? p.condition }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baik">Baik</SelectItem>
                    <SelectItem value="rusak">Rusak</SelectItem>
                    <SelectItem value="kurang_layak_pakai">Kurang layak pakai</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Status</Label>
                <Select value={f.status} onValueChange={(v) => setF((p) => ({ ...p, status: v ?? p.status }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktif</SelectItem>
                    <SelectItem value="in_maintenance">Maintenance</SelectItem>
                    <SelectItem value="damaged">Rusak</SelectItem>
                    <SelectItem value="lost">Hilang</SelectItem>
                    <SelectItem value="disposed">Disposed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.is_critical} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, is_critical: v }))} />
              <Label>Kritis (SLA tiket 2 jam)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.active} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, active: v }))} />
              <Label>Aktif</Label>
            </div>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <Button type="submit" disabled={busy}>{busy ? "Menyimpan…" : "Simpan"}</Button>
            <DialogClose render={<Button type="button" variant="outline" />}>Batal</DialogClose>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
