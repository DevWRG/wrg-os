"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogBody, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export function AddGaAssetCategoryButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({ code: "", nama: "", depreciation_years: "", icon: "", is_shared: false, default_recur_months: "" });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ga-asset-categories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: f.code.trim(),
          nama: f.nama.trim(),
          depreciation_years: f.depreciation_years ? Number(f.depreciation_years) : undefined,
          icon: f.icon.trim() || undefined,
          is_shared: f.is_shared,
          default_recur_months: f.default_recur_months ? Number(f.default_recur_months) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "gagal menyimpan");
      setF({ code: "", nama: "", depreciation_years: "", icon: "", is_shared: false, default_recur_months: "" });
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
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus /> Tambah Kategori
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Tambah kategori aset</DialogTitle>
          <DialogDescription>Kode harus unik (mis. AST-ELK).</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="contents">
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="gac-code">Kode</Label>
              <Input id="gac-code" value={f.code} onChange={(e) => setF((p) => ({ ...p, code: e.target.value }))} placeholder="AST-ELK" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gac-nama">Nama</Label>
              <Input id="gac-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} placeholder="Elektronik" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gac-dep">Depresiasi (tahun)</Label>
              <Input id="gac-dep" type="number" min={0} value={f.depreciation_years} onChange={(e) => setF((p) => ({ ...p, depreciation_years: e.target.value }))} placeholder="opsional" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gac-icon">Ikon (emoji)</Label>
              <Input id="gac-icon" value={f.icon} onChange={(e) => setF((p) => ({ ...p, icon: e.target.value }))} placeholder="opsional, mis. 💻" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="gac-recur">Interval Maintenance Default (bulan)</Label>
              <Input id="gac-recur" type="number" min={0} max={60} value={f.default_recur_months} onChange={(e) => setF((p) => ({ ...p, default_recur_months: e.target.value }))} placeholder="mis. 6 utk kendaraan, 3 utk AC — opsional" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={f.is_shared} onCheckedChange={(v: boolean) => setF((p) => ({ ...p, is_shared: v }))} />
              <Label>Shared (boleh multi-PIC aktif sekaligus)</Label>
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
