"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

interface Category {
  id: string;
  code: string;
  nama: string;
  depreciation_years: number | null;
  icon: string | null;
  is_shared: boolean;
  default_recur_months: number | null;
  active: boolean;
}

export function GaAssetCategoryRowActions({ category }: { category: Category }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: category.nama,
    depreciation_years: category.depreciation_years?.toString() ?? "",
    icon: category.icon ?? "",
    is_shared: category.is_shared,
    default_recur_months: category.default_recur_months?.toString() ?? "",
    active: category.active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-asset-categories/${category.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          depreciation_years: f.depreciation_years ? Number(f.depreciation_years) : undefined,
          icon: f.icon.trim() || undefined,
          is_shared: f.is_shared,
          default_recur_months: f.default_recur_months ? Number(f.default_recur_months) : undefined,
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit — {category.code}</DialogTitle>
          <DialogDescription>Update nama, depresiasi, ikon, shared, aktif/nonaktif.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gace-nama">Nama</Label>
              <Input id="gace-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gace-dep">Depresiasi (tahun)</Label>
              <Input id="gace-dep" type="number" min={0} value={f.depreciation_years} onChange={(e) => setF((p) => ({ ...p, depreciation_years: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gace-icon">Ikon (emoji)</Label>
              <Input id="gace-icon" value={f.icon} onChange={(e) => setF((p) => ({ ...p, icon: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gace-recur">Interval Maintenance Default (bulan)</Label>
              <Input id="gace-recur" type="number" min={0} max={60} value={f.default_recur_months} onChange={(e) => setF((p) => ({ ...p, default_recur_months: e.target.value }))} placeholder="mis. 6 utk kendaraan, 3 utk AC" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.is_shared} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, is_shared: v }))} />
              <Label>Shared (boleh multi-PIC aktif sekaligus)</Label>
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
