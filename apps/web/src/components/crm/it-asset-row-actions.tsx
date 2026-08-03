"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Asset {
  id: string;
  asset_code: string;
  nama: string;
  lokasi: string | null;
  pic_default: string | null;
  is_critical: boolean;
  active: boolean;
}

export function ItAssetRowActions({ asset }: { asset: Asset }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    nama: asset.nama,
    lokasi: asset.lokasi ?? "",
    pic_default: asset.pic_default ?? "",
    is_critical: asset.is_critical,
    active: asset.active,
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/it-assets/${asset.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nama: f.nama.trim() || undefined,
          lokasi: f.lokasi.trim() || undefined,
          pic_default: f.pic_default.trim() || undefined,
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit — {asset.asset_code}</DialogTitle>
          <DialogDescription>Update nama, lokasi, PIC default, status kritis, aktif/nonaktif.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ia-nama">Nama</Label>
              <Input id="ia-nama" value={f.nama} onChange={(e) => setF((p) => ({ ...p, nama: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ia-lokasi">Lokasi</Label>
              <Input id="ia-lokasi" value={f.lokasi} onChange={(e) => setF((p) => ({ ...p, lokasi: e.target.value }))} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ia-pic">PIC Default</Label>
              <Input id="ia-pic" value={f.pic_default} onChange={(e) => setF((p) => ({ ...p, pic_default: e.target.value }))} />
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
